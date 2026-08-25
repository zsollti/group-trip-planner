import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";

/**
 * The operator's console (e2e, real DB).
 *
 * The console is the one surface in this app where the guard *is* the feature:
 * everything behind it reads across every account in the system, so "who may
 * open it" carries more weight here than on any trip route. These cases are
 * about that boundary first and the payloads second.
 *
 * The sweep at the bottom is the important one, and it is deliberately built the
 * same way as the trip-scoped IDOR sweep: it reads the routes Express actually
 * has registered under `/admin` and requires each of them to be closed to an
 * ordinary account. A future `/admin/something` that ships without the guard
 * fails this test without anyone remembering to extend it.
 */
describe("Admin console (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const adminEmail = `admin+${suffix}@example.com`;
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  let adminToken = "";
  let plainToken = "";
  let plainUserId = "";
  const sentVerifications: string[] = [];

  async function makeUser(label: string, verified = true) {
    const email = label.includes("@")
      ? label
      : `adm+${label}+${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: verified,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
    return { user, accessToken: await tokens_.signAccessToken(user) };
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: (to: string) => {
        sentVerifications.push(to);
        return Promise.resolve();
      },
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
    };
    // The operator list has to be injected rather than set in `process.env`:
    // importing AppModule runs `ConfigModule.forRoot()`, which parses the
    // environment while the module metadata is built — before any `before()`
    // hook in this file could set a variable. The env schema's own parsing of
    // the raw string (splitting, trimming, lowercasing) is covered in
    // `admin.spec.ts`, where it can be tested directly instead of inferred
    // through an HTTP status.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), ADMIN_EMAILS: [adminEmail] })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);

    ({ accessToken: adminToken } = await makeUser(adminEmail));
    const plain = await makeUser("plain", false);
    plainToken = plain.accessToken;
    plainUserId = plain.user.id;
  });

  after(async () => {
    if (prisma) {
      await prisma.adminAuditEvent.deleteMany({
        where: { actorEmail: adminEmail },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it("lets a configured operator read the overview", async () => {
    const res = await http()
      .get("/admin/overview")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const body = res.body as {
      system: { contractVersion: string };
      volume: { users: number; signups: unknown[] };
      email: { pending: number };
      rates: { configured: boolean };
    };
    assert.ok(body.system.contractVersion.length > 0);
    assert.ok(body.volume.users >= 2);
    // Zero-filled: always exactly 30 days, however quiet the month was.
    assert.equal(body.volume.signups.length, 30);
    assert.equal(typeof body.email.pending, "number");
    assert.equal(typeof body.rates.configured, "boolean");
  });

  it("finds a user by email fragment and reports their verification state", async () => {
    // Encoded, because these addresses carry a `+` and a raw one in a query
    // string is a space — the search would quietly look for something else.
    const res = await http()
      .get(`/admin/users?q=${encodeURIComponent(`plain+${suffix}`)}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const body = res.body as {
      users: { id: string; emailVerified: boolean }[];
    };
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0]!.id, plainUserId);
    assert.equal(body.users[0]!.emailVerified, false);
  });

  it("does not 500 on a lookup that looks like a broken id", async () => {
    // Postgres rejects a malformed uuid as a type error rather than matching
    // nothing, so an unguarded `{ id: q }` would turn one stray character into
    // a 500 on the operator's own search box.
    const res = await http()
      .get("/admin/users?q=not-a-uuid-but-36-characters-long!!")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.deepEqual((res.body as { users: unknown[] }).users, []);
  });

  it("resends a verification email and records who did it", async () => {
    const before_ = sentVerifications.length;
    await http()
      .post(`/admin/users/${plainUserId}/resend-verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    assert.equal(sentVerifications.length, before_ + 1);
    const audit = await http()
      .get("/admin/audit")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const entries = (
      audit.body as { entries: { action: string; actorEmail: string }[] }
    ).entries;
    assert.ok(
      entries.some(
        (e) =>
          e.action === "VERIFICATION_RESENT" && e.actorEmail === adminEmail,
      ),
      "the resend should be attributable to the operator who did it",
    );
  });

  it("marks an account verified, and says so in the answer", async () => {
    const res = await http()
      .post(`/admin/users/${plainUserId}/verify`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    assert.equal((res.body as { emailVerified: boolean }).emailVerified, true);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: plainUserId },
    });
    assert.equal(row.emailVerified, true);
  });

  it("rebuilds the demo trip, and builds the demo it promises", async () => {
    // The console's one destructive action, and the one thing here that writes
    // trip content. Two halves are worth pinning: that it is attributable, and
    // that what it produces still demonstrates what the demo exists to show —
    // the seed is a fixture for strangers, so a change that quietly flattened it
    // would leave the app looking simpler than it is.
    //
    // The demo accounts are deliberately *not* cleaned up afterwards. They are
    // upserted, so a second run is a no-op on them, and locally this leaves the
    // same demo trip behind that `pnpm demo:seed` would.
    const res = await http()
      .post("/admin/demo-seed")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const body = res.body as {
      tripId: string;
      email: string;
      members: number;
      options: number;
      decisions: number;
      messages: number;
    };
    assert.equal(body.email, "demo@example.com");
    assert.equal(body.members, 5);
    // Floors, not exact counts. The figures span **both** demo boards now — the
    // active trip and the ended one built beside it — and an equality here
    // turned a fixture gaining a decision into a failing build, which is what it
    // did the day the second trip landed. What is worth pinning is that the seed
    // still produces a board with real business on it; the exact tally is the
    // seed's own business, and `demo-seed.e2e-spec.ts` is where its shape is
    // asserted properly.
    assert.ok(body.decisions >= 7, "the demo still shows locked decisions");
    assert.ok(body.options >= 15, "every seeded option is counted");

    const audit = await http()
      .get("/admin/audit")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(
      (
        audit.body as { entries: { action: string; actorEmail: string }[] }
      ).entries.some(
        (e) => e.action === "DEMO_RESEEDED" && e.actorEmail === adminEmail,
      ),
      "a rebuild names the operator who ran it",
    );

    const options = await prisma.option.findMany({
      where: { category: { tripId: body.tripId } },
      include: {
        participants: { select: { userId: true } },
        category: { select: { builtinKey: true, singleChoice: true } },
      },
    });
    assert.equal(options.length, body.options);

    // A multi-select lane that is decided **and** still open, which is the case
    // the board's whole layout exists for and the one a demo where every lane
    // held at most one decision could never show. It is also the case the seed
    // used to fake: it writes locks with `prisma.option.update`, so before the
    // lanes seeded multi-select it was producing two locked options in a lane
    // the API itself refuses to let anyone lock twice.
    const activities = options.filter(
      (o) => o.category.builtinKey === "ACTIVITIES",
    );
    assert.equal(
      activities[0]!.category.singleChoice,
      false,
      "Activities is multi-select, so two decisions there are legal",
    );
    assert.equal(
      activities.filter((o) => o.status === "LOCKED").length,
      2,
      "two activities are decided",
    );
    assert.ok(
      activities.some((o) => o.status === "PROPOSED"),
      "and the lane is still open underneath them",
    );

    // Times, because the itinerary needs them — and not on everything, because
    // the itinerary's "not placed" list is the honest half of that page and a
    // demo where nothing is missing never shows it.
    const timed = options.filter((o) => o.startsAt !== null);
    assert.ok(
      timed.length >= 8,
      "most decisions can be placed on the timeline",
    );
    assert.ok(
      options.some((o) => o.startsAt === null),
      "and at least one cannot, so the unscheduled list is demonstrated",
    );

    // The way home, on the last day. A trip whose transport all happens on the
    // arrival day reads as a group that never left, and the demo's last day was
    // the one day of it with nothing on it at all. Asserted against the trip's
    // own end date rather than against a title, so renaming the flight does not
    // quietly delete the case.
    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: body.tripId },
      select: { endDate: true },
    });
    const lastDay = trip.endDate!.toISOString().slice(0, 10);
    assert.ok(
      options.some(
        (o) =>
          o.status === "LOCKED" &&
          o.startsAt !== null &&
          o.startsAt.toISOString().slice(0, 10) === lastDay,
      ),
      "something settled gets the group home on the last day",
    );

    // Both sides of "I'm in": one opt-in option the demo account joined, and one
    // it did not. With only the first, a visitor could see who was in but never
    // the invitation to join.
    const demo = await prisma.user.findUniqueOrThrow({
      where: { email: "demo@example.com" },
      select: { id: true },
    });
    const optIn = options.filter((o) => o.participationMode === "OPT_IN");
    assert.equal(
      optIn.length,
      2,
      "two opt-in options, so both states are on screen",
    );
    const joined = optIn.filter((o) =>
      o.participants.some((p) => p.userId === demo.id),
    );
    assert.equal(joined.length, 1);
    // The one it joined has company; the one it didn't is somebody else's plan.
    assert.ok(joined[0]!.participants.length > 1);
    const notJoined = optIn.find((o) => o !== joined[0])!;
    assert.ok(notJoined.participants.length > 0);
  });

  /**
   * Suspension, end to end: the console writes it, and sign-in reads it.
   *
   * Deliberately one case rather than four, because the thing worth pinning is
   * the *join* between them — the console could write three perfect columns and
   * the login path could ignore them, and each half would still pass its own
   * test. So this bans a real account with a real password and then tries the
   * front door with the right credentials.
   */
  it("suspends an account, and the account is told why at sign-in", async () => {
    const email = `banned+${suffix}@example.com`;
    const password = "Correct-Horse9Battery";
    const victim = await prisma.user.create({
      data: {
        email,
        displayName: "Banned Person",
        emailVerified: true,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    userIds.push(victim.id);

    // The password works before the ban — otherwise the assertion after it
    // would prove nothing about the ban.
    await http().post("/auth/login").send({ email, password }).expect(200);

    const banned = await http()
      .post(`/admin/users/${victim.id}/ban`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ until: null, reason: "Spamming every board they joined." })
      .expect(201);
    const state = (banned.body as { ban: { banReason: string } | null }).ban;
    assert.ok(state, "the answer should report the suspension it just applied");
    assert.equal(state.banReason, "Spamming every board they joined.");

    const refused = await http()
      .post("/auth/login")
      .send({ email, password })
      .expect(403);
    // The point of the whole feature: the person is told, not just stopped.
    assert.match((refused.body as { message: string }).message, /suspended/i);
    assert.match(
      (refused.body as { message: string }).message,
      /Spamming every board/,
    );

    // And it is attributable, with its terms, like every other write here.
    const audit = await http()
      .get("/admin/audit")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.ok(
      (
        audit.body as { entries: { action: string; subject: string | null }[] }
      ).entries.some(
        (e) => e.action === "USER_BANNED" && e.subject?.includes(email),
      ),
    );

    // Lifting it lets them back in, which is the half a ban feature most often
    // ships without.
    await http()
      .post(`/admin/users/${victim.id}/unban`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    await http().post("/auth/login").send({ email, password }).expect(200);
  });

  it("kills the live session, not just the next sign-in", async () => {
    // A ban that only closed the front door would be decorative: an open tab
    // keeps its access token for its full life and its refresh cookie for a
    // fortnight. Both are checked here because they fail in different places —
    // the per-request guard and the rotation — and each was a separate line.
    const { user, accessToken } = await makeUser("sessioned");
    const refresh = await http()
      .post("/auth/login")
      .send({ email: user.email, password: "irrelevant" });
    assert.ok(refresh.status >= 400, "the seeded hash is not a real password");

    await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    await http()
      .post(`/admin/users/${user.id}/ban`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ until: null, reason: "Mid-session." })
      .expect(201);

    // The token is still valid and still in date. It is the per-request DB read
    // that stops it — the same read the whole authorization model rests on.
    await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);
  });

  it("lets a suspension lapse on its own, without anything sweeping it", async () => {
    const { user, accessToken } = await makeUser("lapsing");
    // Yesterday: a ban that has already run out. Written straight to the row
    // because the endpoint takes a date and cannot be asked for a past one —
    // and the rule under test is the *read*, which is what makes an expiry work
    // with no scheduler behind it.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        bannedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        bannedUntil: yesterday,
        banReason: "Served.",
      },
    });

    await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    // …and the console still shows what happened, which is the reason the row
    // is not cleared when it expires.
    const found = await http()
      .get(`/admin/users?q=${encodeURIComponent(user.email)}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const summary = (
      found.body as { users: { ban: { banReason: string } | null }[] }
    ).users[0];
    assert.equal(summary?.ban?.banReason, "Served.");
  });

  it("refuses to let an operator suspend themselves", async () => {
    // The console is gated on the address, so this would lock the person
    // pressing it out of the only tool that could undo it.
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    await http()
      .post(`/admin/users/${me.id}/ban`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ until: null, reason: "Testing." })
      .expect(400);
  });

  /**
   * Erasing an account, and the branch that decides what happens to its trips.
   *
   * One test covering both outcomes on purpose: the interesting thing is not
   * that a delete works, it is that **the same act does two different things**
   * depending on who else is on the board, and a test that only exercised one
   * would leave the other free to be wrong.
   */
  it("erases an account, handing on the trips that have somewhere to go", async () => {
    const owner = await makeUser("owner");
    const heir = await makeUser("heir");

    const shared = await prisma.trip.create({
      data: {
        name: "Shared board",
        ownerId: owner.user.id,
        startDate: new Date("2099-06-01"),
        endDate: new Date("2099-06-08"),
        expiresAt: new Date("2099-07-08"),
        memberships: {
          create: [
            { userId: owner.user.id, role: "OWNER" },
            { userId: heir.user.id, role: "CO_ORGANIZER" },
          ],
        },
      },
    });
    const solo = await prisma.trip.create({
      data: {
        name: "Solo board",
        ownerId: owner.user.id,
        startDate: new Date("2099-06-01"),
        endDate: new Date("2099-06-08"),
        expiresAt: new Date("2099-07-08"),
        memberships: { create: [{ userId: owner.user.id, role: "OWNER" }] },
      },
    });

    const res = await http()
      .post(`/admin/users/${owner.user.id}/delete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);

    const body = res.body as {
      email: string;
      impact: {
        transfers: { tripId: string; successorUserId: string }[];
        deletions: { tripId: string }[];
      };
    };
    // The address is snapshotted before the erasure — afterwards there is
    // nothing left to name the account with.
    assert.equal(body.email, owner.user.email);
    assert.deepEqual(
      body.impact.transfers.map((t) => t.tripId),
      [shared.id],
    );
    assert.equal(body.impact.transfers[0]!.successorUserId, heir.user.id);
    assert.deepEqual(
      body.impact.deletions.map((t) => t.tripId),
      [solo.id],
    );

    // …and the database agrees with the report, which is the half a summary
    // object cannot vouch for on its own.
    const after = await prisma.trip.findUnique({ where: { id: shared.id } });
    assert.equal(after?.ownerId, heir.user.id);
    assert.equal(
      await prisma.trip.findUnique({ where: { id: solo.id } }),
      null,
    );

    const erased = await prisma.user.findUniqueOrThrow({
      where: { id: owner.user.id },
    });
    assert.ok(erased.anonymizedAt, "the row is kept, the person is not");
    assert.equal(erased.displayName, "Deleted user");
    assert.notEqual(erased.email, owner.user.email);

    // Their session is over: the guard rejects an anonymized row.
    await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(401);

    // Cleaned up here rather than in `after`, because the transfer is exactly
    // what makes the shared board outlive this test: `Trip.ownerId` restricts,
    // so the heir cannot be deleted while still owning it and the whole
    // teardown fails — one line after every individual case had passed.
    await prisma.trip.delete({ where: { id: shared.id } });
  });

  it("refuses to let an operator erase themselves from here", async () => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    await http()
      .post(`/admin/users/${me.id}/delete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  it("reports operator status on the session, so the app can offer the link", async () => {
    const asAdmin = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    assert.equal((asAdmin.body as { isAdmin: boolean }).isAdmin, true);

    const asPlain = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${plainToken}`)
      .expect(200);
    assert.equal((asPlain.body as { isAdmin: boolean }).isAdmin, false);
  });

  it("answers 401 to an anonymous caller, before it answers anything else", async () => {
    await http().get("/admin/overview").expect(401);
  });

  /**
   * The self-maintaining half: every registered `/admin` route, closed.
   *
   * **404 and not 403**, which is the one place this app departs from its own
   * convention of preferring the honest status. A 403 would confirm to any
   * signed-in stranger that a console exists here and that they are merely not
   * on the list — a free hint on the highest-value surface in the app. To a
   * non-operator the console does not exist, which is also exactly true of any
   * deployment that never sets `ADMIN_EMAILS`.
   */
  it("hides every admin route from an ordinary account", async () => {
    const routes = registeredAdminRoutes(app);
    assert.ok(
      routes.length > 0,
      "expected some /admin routes to be registered",
    );

    for (const { method, path } of routes) {
      // A concrete url for the one parameterised family; the rest are literal.
      const url = path.replace(":id", plainUserId);
      const res = await (
        http() as unknown as Record<string, (u: string) => request.Test>
      )[method]!(url)
        .set("Authorization", `Bearer ${plainToken}`)
        .send();
      assert.equal(
        res.status,
        404,
        `${method.toUpperCase()} ${path} answered ${res.status} to a non-operator`,
      );
    }
  });
});

interface ExpressLayer {
  route?: {
    path?: string | string[];
    methods?: Record<string, boolean>;
    stack?: { method?: string }[];
  };
}

/**
 * The `/admin` routes Express actually has, read from its own table.
 *
 * The point of reading the router rather than listing the routes by hand: a
 * table written today only ever covers the routes that existed today, and the
 * dangerous case is precisely the route somebody adds later.
 */
function registeredAdminRoutes(
  app: INestApplication,
): { method: string; path: string }[] {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack?: ExpressLayer[] };
    _router?: { stack?: ExpressLayer[] };
  };
  const stack = instance.router?.stack ?? instance._router?.stack ?? [];

  const found: { method: string; path: string }[] = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route?.path) continue;
    const paths = Array.isArray(route.path) ? route.path : [route.path];
    const methods = route.methods
      ? Object.entries(route.methods)
          .filter(([, on]) => on)
          .map(([m]) => m)
      : (route.stack ?? []).map((l) => l.method ?? "");
    for (const path of paths) {
      if (!path.startsWith("/admin")) continue;
      for (const method of methods) {
        if (method && method !== "_all") found.push({ method, path });
      }
    }
  }
  return found;
}
