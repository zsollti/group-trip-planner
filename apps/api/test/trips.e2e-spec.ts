import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TRIP_CREATE_THROTTLE } from "../src/common/throttle-policy.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Trips spine integration test (real DB). Covers the Phase-1.1 DoD:
 * - a verified user creates a trip and becomes Owner;
 * - an unverified user is blocked from creating (verified-email gate);
 * - the trip shows up in the owner's list;
 * - a non-member hitting GET /trips/:id gets a 404 (existence not leaked);
 * - the public preview returns only the four allowed Visitor fields.
 */
describe("Trips (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  // Captured verification tokens, keyed by email.
  const tokens = new Map<string, string>();
  const suffix = Date.now();
  const emails: string[] = [];

  /** Register + (optionally) verify + login; returns a cookie-carrying agent
   * and the in-memory access token. */
  async function makeUser(opts: { verified: boolean; label: string }) {
    const email = `trips+${opts.label}+${suffix}@example.com`;
    emails.push(email);
    const password = "correct-horse-battery";
    const agent = request.agent(app.getHttpServer());

    await agent
      .post("/auth/register")
      .send({ email, password, displayName: opts.label })
      .expect(201);

    if (opts.verified) {
      const token = tokens.get(email);
      assert.ok(token, `verification token issued for ${email}`);
      await agent.post("/auth/verify").send({ token }).expect(200);
    }

    const login = await agent
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    return { agent, accessToken: login.body.accessToken as string, email };
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: (to: string, token: string) => {
        tokens.set(to, token);
        return Promise.resolve();
      },
      sendAccountExistsNotice: () => Promise.resolve(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
  });

  after(async () => {
    if (prisma) {
      // Trips cascade their memberships; then remove the test users.
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      await prisma.trip.deleteMany({
        where: { ownerId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("a verified user creates a trip and becomes Owner", async () => {
    const owner = await makeUser({ verified: true, label: "owner" });

    const res = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Lisbon 2026", destination: "Lisbon" });

    assert.equal(res.status, 201);
    assert.equal(res.body.name, "Lisbon 2026");
    assert.equal(res.body.role, "OWNER");
    assert.equal(res.body.memberCount, 1);
    assert.equal(res.body.status, "ACTIVE");
    assert.equal(res.body.defaultCurrency, "EUR");
    assert.ok(res.body.expiresAt, "an expiry fallback is set");

    // It appears in the owner's trip list.
    const list = await owner.agent
      .get("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.ok(
      list.body.some(
        (t: { id: string }) => t.id === (res.body as { id: string }).id,
      ),
      "created trip is in the list",
    );
  });

  it("an unverified user cannot create a trip", async () => {
    const rookie = await makeUser({ verified: false, label: "rookie" });
    const res = await rookie.agent
      .post("/trips")
      .set("Authorization", `Bearer ${rookie.accessToken}`)
      .send({ name: "Should Fail" });
    assert.equal(res.status, 403);
  });

  it("a non-member hitting /trips/:id gets 404, not 403", async () => {
    const owner = await makeUser({ verified: true, label: "owner2" });
    const stranger = await makeUser({ verified: true, label: "stranger" });

    const created = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Private Trip" })
      .expect(201);

    const asStranger = await stranger.agent
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);
    assert.equal(
      asStranger.status,
      404,
      "existence is not leaked to outsiders",
    );

    const asMember = await owner.agent
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(asMember.body.id, created.body.id);
  });

  it("the public preview returns only the four Visitor fields", async () => {
    const owner = await makeUser({ verified: true, label: "owner3" });
    const created = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Preview Me", destination: "Porto", description: "secret" })
      .expect(201);

    // No auth header — this is the public Visitor scope.
    const preview = await request(app.getHttpServer())
      .get(`/trips/${created.body.id}/preview`)
      .expect(200);

    assert.deepEqual(
      Object.keys(preview.body).sort(),
      ["destination", "endDate", "id", "memberCount", "name", "startDate"],
      "preview leaks nothing beyond the four allowed fields + id",
    );
    assert.equal(preview.body.name, "Preview Me");
    assert.equal(preview.body.destination, "Porto");
    assert.equal(preview.body.memberCount, 1);
    assert.equal(preview.body.description, undefined);
    assert.equal(preview.body.role, undefined);
    assert.equal(preview.body.ownerId, undefined);
  });

  it("preview of a nonexistent trip is a 404", async () => {
    const res = await request(app.getHttpServer()).get(
      "/trips/00000000-0000-4000-8000-000000000000/preview",
    );
    assert.equal(res.status, 404);
  });

  // --- Phase 1.2: authorization guard + optimistic-concurrency edit path ---
  //
  // These build multi-role trips, which needs many users. Rather than drive
  // register/login (rate-limited by design — that's the auth e2e's job), we
  // insert verified users directly and mint their access tokens: the JwtAuthGuard
  // still loads them fresh from the DB, so the authz path under test is real.

  const http = () => request(app.getHttpServer());

  /** Insert a verified user directly and mint a valid access token for them. */
  async function makeVerifiedUser(label: string) {
    const email = `trips-authz+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
        passwordHash: "x", // never used — these users never log in
      },
    });
    const accessToken = await tokens_.signAccessToken(user);
    return { user, accessToken, email };
  }

  /** Seed a membership row directly (invites arrive in 1.3). */
  async function addMember(
    tripId: string,
    userId: string,
    role: "CO_ORGANIZER" | "PARTICIPANT" | "GUEST",
  ) {
    await prisma.tripMembership.create({ data: { tripId, userId, role } });
  }

  /**
   * Optional create-form dates (post-launch). The contract is that they are not
   * a second writer of the trip's date columns: they seed an already-locked
   * Dates option and the ordinary write-back does the rest, so unlocking still
   * reopens the question. These assert that from the outside — the columns, the
   * lane, and the fact that the same rules a later lock enforces apply here.
   *
   * Users are inserted directly (`makeVerifiedUser`) for the reason given above
   * — these cases need several accounts and the register route's own per-IP
   * limit would fire before the behaviour under test.
   */
  describe("creating a trip with dates", () => {
    /** An ISO instant `days` from now, at midday UTC to dodge timezone edges. */
    function isoInDays(days: number): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      d.setUTCHours(12, 0, 0, 0);
      return d.toISOString();
    }

    it("writes the trip's dates and seeds a locked Dates option", async () => {
      const owner = await makeVerifiedUser("dated");
      const startDate = isoInDays(30);
      const endDate = isoInDays(37);

      const trip = await http()
        .post("/trips")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: "Lisbon, booked", startDate, endDate })
        .expect(201);

      // The trip's own columns are `@db.Date` — date-only by design, since a
      // trip runs on days, not instants. The option keeps the full instant.
      const day = (iso: string) => iso.slice(0, 10);
      assert.equal(day(trip.body.startDate), day(startDate));
      assert.equal(day(trip.body.endDate), day(endDate));
      // Expiry follows the locked end date (+1 month), not the +1 year fallback.
      const expiry = new Date(trip.body.expiresAt).getTime();
      assert.ok(
        expiry < Date.now() + 300 * 24 * 3600 * 1000,
        "expiry derives from the dates, not the one-year fallback",
      );

      const cats = await http()
        .get(`/trips/${trip.body.id}/categories`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      const dates = (cats.body as { id: string; builtinKey: string }[]).find(
        (c) => c.builtinKey === "DATES",
      )!;

      const opts = await http()
        .get(`/trips/${trip.body.id}/categories/${dates.id}/options`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      assert.equal(opts.body.length, 1, "the Dates lane is not left empty");
      assert.equal(opts.body[0].status, "LOCKED");
      assert.equal(new Date(opts.body[0].startsAt).toISOString(), startDate);
      assert.equal(new Date(opts.body[0].endsAt).toISOString(), endDate);
    });

    it("leaves the Dates lane empty when no dates are given", async () => {
      const owner = await makeVerifiedUser("undated");
      const trip = await http()
        .post("/trips")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: "Someday" })
        .expect(201);

      assert.equal(trip.body.startDate, null);
      assert.equal(trip.body.endDate, null);

      const cats = await http()
        .get(`/trips/${trip.body.id}/categories`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      const dates = (cats.body as { id: string; builtinKey: string }[]).find(
        (c) => c.builtinKey === "DATES",
      )!;
      const opts = await http()
        .get(`/trips/${trip.body.id}/categories/${dates.id}/options`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      assert.equal(opts.body.length, 0);
    });

    it("applies the same date rules a later lock would (FR-25)", async () => {
      const owner = await makeVerifiedUser("baddates");
      const post = (body: Record<string, unknown>) =>
        http()
          .post("/trips")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send(body);

      // A past start is refused here exactly as it is at lock time.
      const past = await post({
        name: "Backdated",
        startDate: isoInDays(-3),
        endDate: isoInDays(4),
      });
      assert.equal(past.status, 400);

      // Beyond the planning horizon.
      const far = await post({
        name: "Far future",
        startDate: isoInDays(500),
        endDate: isoInDays(507),
      });
      assert.equal(far.status, 400);

      // End before start, and one date without the other — both schema-level.
      const reversed = await post({
        name: "Reversed",
        startDate: isoInDays(37),
        endDate: isoInDays(30),
      });
      assert.equal(reversed.status, 400);

      const lonely = await post({ name: "Half", startDate: isoInDays(30) });
      assert.equal(
        lonely.status,
        400,
        "one date alone is refused, not dropped",
      );
    });

    it("lets the group reopen the question by unlocking", async () => {
      const owner = await makeVerifiedUser("reopen");
      const trip = await http()
        .post("/trips")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: "Maybe Lisbon",
          startDate: isoInDays(30),
          endDate: isoInDays(37),
        })
        .expect(201);

      const cats = await http()
        .get(`/trips/${trip.body.id}/categories`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      const dates = (cats.body as { id: string; builtinKey: string }[]).find(
        (c) => c.builtinKey === "DATES",
      )!;
      const opts = await http()
        .get(`/trips/${trip.body.id}/categories/${dates.id}/options`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      const seeded = opts.body[0] as { id: string; version: number };

      await http()
        .post(
          `/trips/${trip.body.id}/categories/${dates.id}/options/${seeded.id}/unlock`,
        )
        .set("Authorization", `Bearer ${owner.accessToken}`)
        // 201: the unlock route is a plain @Post, as the locking suite asserts.
        .send({ version: seeded.version })
        .expect(201);

      // Unlocking reverts the trip to the created+1y fallback (FR-9) — proof the
      // seeded option really is the single writer of the date columns.
      const after = await http()
        .get(`/trips/${trip.body.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);
      assert.equal(after.body.startDate, null);
      assert.equal(after.body.endDate, null);
    });
  });

  it("Owner edits trip details; version bumps and a stale edit 409s", async () => {
    const owner = await makeVerifiedUser("editor");
    const created = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Editable", destination: "Nice" })
      .expect(201);
    assert.equal(created.body.version, 0);

    const edited = await http()
      .patch(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Edited", destination: "Cannes", version: 0 })
      .expect(200);
    assert.equal(edited.body.name, "Edited");
    assert.equal(edited.body.destination, "Cannes");
    assert.equal(edited.body.version, 1, "version increments on edit");

    // Re-using the stale version (0) is rejected as a conflict.
    const stale = await http()
      .patch(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Too late", version: 0 });
    assert.equal(stale.status, 409, "optimistic-concurrency conflict");
  });

  it("guard blocks a non-member editing/deleting (IDOR → 404)", async () => {
    const owner = await makeVerifiedUser("idor-owner");
    const stranger = await makeVerifiedUser("idor-stranger");
    const created = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Not Yours" })
      .expect(201);

    const patch = await http()
      .patch(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ name: "Hijacked", version: 0 });
    assert.equal(patch.status, 404, "existence not leaked to a non-member");

    const del = await http()
      .delete(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);
    assert.equal(del.status, 404);

    // The trip is untouched.
    const still = await http()
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(still.body.name, "Not Yours");
  });

  it("a Participant member cannot edit or delete (403), a Co-organizer can edit but not delete", async () => {
    const owner = await makeVerifiedUser("roles-owner");
    const participant = await makeVerifiedUser("roles-participant");
    const coorg = await makeVerifiedUser("roles-coorg");
    const created = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Role Gated" })
      .expect(201);
    await addMember(created.body.id, participant.user.id, "PARTICIPANT");
    await addMember(created.body.id, coorg.user.id, "CO_ORGANIZER");

    // Participant: member (not 404) but forbidden to edit or delete.
    const pEdit = await http()
      .patch(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .send({ name: "Nope", version: 0 });
    assert.equal(pEdit.status, 403);
    const pDel = await http()
      .delete(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${participant.accessToken}`);
    assert.equal(pDel.status, 403);

    // Co-organizer: may edit...
    const cEdit = await http()
      .patch(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({ name: "Co-org edit", version: 0 })
      .expect(200);
    assert.equal(cEdit.body.name, "Co-org edit");
    // ...but not delete (Owner-only).
    const cDel = await http()
      .delete(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`);
    assert.equal(cDel.status, 403);
  });

  it("Owner deletes the trip (204) and it cascades memberships", async () => {
    const owner = await makeVerifiedUser("deleter");
    const guest = await makeVerifiedUser("delete-guest");
    const created = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Doomed" })
      .expect(201);
    await addMember(created.body.id, guest.user.id, "GUEST");

    await http()
      .delete(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);

    // Trip gone (owner now gets 404) and its memberships cascaded away.
    const gone = await http()
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    assert.equal(gone.status, 404);
    const remaining = await prisma.tripMembership.count({
      where: { tripId: created.body.id },
    });
    assert.equal(remaining, 0, "memberships cascaded on trip delete");
  });
  it("caps trip creation per user, and keys the budget on the account not the IP (Phase 7.1)", async () => {
    // Users are inserted directly rather than registered: the register route's
    // own 5/min limit is per IP and would fire first in a suite that already
    // creates several accounts from this address.
    async function directUser(label: string) {
      const email = `trips+${label}+${suffix}@example.com`;
      emails.push(email);
      const user = await prisma.user.create({
        data: {
          email,
          displayName: label,
          emailVerified: true,
          passwordHash: "x",
        },
      });
      return { user, accessToken: await tokens_.signAccessToken(user) };
    }

    const flooder = await directUser("flood-a");
    const bystander = await directUser("flood-b");
    const limit = TRIP_CREATE_THROTTLE.default.limit;

    for (let i = 0; i < limit; i += 1) {
      await request(app.getHttpServer())
        .post("/trips")
        .set("Authorization", `Bearer ${flooder.accessToken}`)
        .send({ name: `Flood ${i}` })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post("/trips")
      .set("Authorization", `Bearer ${flooder.accessToken}`)
      .send({ name: "One too many" })
      .expect(429);

    // A different account from the SAME address is untouched. This is the whole
    // point of keying on the user, and it did NOT hold before 7.1: the global
    // APP_GUARD throttler read the same @Throttle budget and tracked it by IP,
    // so one office NAT meant one shared allowance.
    await request(app.getHttpServer())
      .post("/trips")
      .set("Authorization", `Bearer ${bystander.accessToken}`)
      .send({ name: "Unaffected" })
      .expect(201);
  });
});
