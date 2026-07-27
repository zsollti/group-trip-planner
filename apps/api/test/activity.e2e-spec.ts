import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { ActivityPage } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * The trip activity feed (Phase 5.4) against a real DB — the slice's DoD:
 *
 *  - every retrofitted action (role change, kick, block, unblock, transfer,
 *    departure) and the Phase-2 decisions appear with actor, target and time;
 *  - the feed is **member-scoped** — a non-member gets 404, not a log;
 *  - it is paginated, newest first, with no gaps or repeats across pages;
 *  - it **mirrors** the audit log: an action that was rejected or that changed
 *    nothing writes no event.
 */
describe("Activity feed (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string) {
    const email = `activity+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    return { user, accessToken: await tokens_.signAccessToken(user), email };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body as { id: string };
  }

  async function addMember(
    tripId: string,
    userId: string,
    role: "CO_ORGANIZER" | "PARTICIPANT" | "GUEST" = "PARTICIPANT",
  ) {
    await prisma.tripMembership.create({ data: { tripId, userId, role } });
  }

  async function feed(
    accessToken: string,
    tripId: string,
    query = "",
  ): Promise<ActivityPage> {
    const res = await http()
      .get(`/trips/${tripId}/activity${query}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body as ActivityPage;
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
      sendMentionEmail: () => Promise.resolve(),
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
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      await prisma.emailJob.deleteMany({ where: { userId: { in: ids } } });
      await prisma.trip.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("records a role change with actor, target, both roles and a time", async () => {
    const owner = await makeUser("role-owner");
    const grace = await makeUser("role-grace");
    const trip = await createTrip(owner.accessToken, "Role change");
    await addMember(trip.id, grace.user.id, "GUEST");

    await http()
      .patch(`/trips/${trip.id}/members/${grace.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "PARTICIPANT" })
      .expect(200);

    const page = await feed(owner.accessToken, trip.id);
    assert.equal(page.events.length, 1);
    const [event] = page.events;
    assert.equal(event!.action, "MEMBER_ROLE_CHANGED");
    assert.equal(event!.actorName, "role-owner");
    assert.equal(event!.targetName, "role-grace");
    assert.equal(event!.fromRole, "GUEST");
    assert.equal(event!.toRole, "PARTICIPANT");
    assert.ok(Date.parse(event!.createdAt) > 0);
  });

  it("records kicks, blocks, unblocks and departures", async () => {
    const owner = await makeUser("mem-owner");
    const kicked = await makeUser("mem-kicked");
    const blocked = await makeUser("mem-blocked");
    const leaver = await makeUser("mem-leaver");
    const trip = await createTrip(owner.accessToken, "Membership churn");
    await addMember(trip.id, kicked.user.id);
    await addMember(trip.id, blocked.user.id);
    await addMember(trip.id, leaver.user.id);

    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    await http()
      .delete(`/trips/${trip.id}/members/${kicked.user.id}`)
      .set(auth)
      .expect(204);
    await http()
      .post(`/trips/${trip.id}/members/${blocked.user.id}/block`)
      .set(auth)
      .expect(204);
    await http()
      .delete(`/trips/${trip.id}/members/${blocked.user.id}/block`)
      .set(auth)
      .expect(204);
    await http()
      .post(`/trips/${trip.id}/members/leave`)
      .set("Authorization", `Bearer ${leaver.accessToken}`)
      .expect(204);

    const page = await feed(owner.accessToken, trip.id);
    // Newest first.
    assert.deepEqual(
      page.events.map((e) => e.action),
      ["MEMBER_LEFT", "MEMBER_UNBLOCKED", "MEMBER_BLOCKED", "MEMBER_KICKED"],
    );
    // Names survive the membership rows that are now gone — the snapshot is the
    // whole point of writing them at the source.
    const byAction = new Map(page.events.map((e) => [e.action, e]));
    assert.equal(byAction.get("MEMBER_KICKED")?.targetName, "mem-kicked");
    assert.equal(byAction.get("MEMBER_BLOCKED")?.targetName, "mem-blocked");
    assert.equal(byAction.get("MEMBER_UNBLOCKED")?.targetName, "mem-blocked");
    // A departure is reported in the leaver's own name, not the owner's.
    assert.equal(byAction.get("MEMBER_LEFT")?.actorName, "mem-leaver");
  });

  it("records an ownership transfer", async () => {
    const owner = await makeUser("xfer-owner");
    const heir = await makeUser("xfer-heir");
    const trip = await createTrip(owner.accessToken, "Handover");
    await addMember(trip.id, heir.user.id, "CO_ORGANIZER");

    await http()
      .post(`/trips/${trip.id}/members/transfer`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ userId: heir.user.id })
      .expect(204);

    const page = await feed(heir.accessToken, trip.id);
    assert.equal(page.events[0]?.action, "OWNERSHIP_TRANSFERRED");
    assert.equal(page.events[0]?.actorName, "xfer-owner");
    assert.equal(page.events[0]?.targetName, "xfer-heir");
  });

  it("mirrors the log: a rejected or no-op action writes nothing", async () => {
    const owner = await makeUser("noop-owner");
    const grace = await makeUser("noop-grace");
    const trip = await createTrip(owner.accessToken, "No-ops");
    await addMember(trip.id, grace.user.id, "PARTICIPANT");

    // Setting the role it already has is a no-op …
    await http()
      .patch(`/trips/${trip.id}/members/${grace.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "PARTICIPANT" })
      .expect(200);
    // … unblocking someone who was never blocked undoes nothing …
    await http()
      .delete(`/trips/${trip.id}/members/${grace.user.id}/block`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
    // … and a rejected action (a Participant cannot manage anyone) is refused
    // before it could write.
    await http()
      .delete(`/trips/${trip.id}/members/${owner.user.id}`)
      .set("Authorization", `Bearer ${grace.accessToken}`)
      .expect(403);

    const page = await feed(owner.accessToken, trip.id);
    assert.deepEqual(page.events, [], "the feed reports only what happened");
  });

  it("is member-scoped: a non-member gets 404, not a log", async () => {
    const owner = await makeUser("scope-owner");
    const outsider = await makeUser("scope-outsider");
    const guest = await makeUser("scope-guest");
    const trip = await createTrip(owner.accessToken, "Scoped");
    await addMember(trip.id, guest.user.id, "GUEST");

    await http()
      .get(`/trips/${trip.id}/activity`)
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .expect(404);
    await http().get(`/trips/${trip.id}/activity`).expect(401);
    // Any member may read it, Guests included — the group audits its organizers.
    await feed(guest.accessToken, trip.id);
  });

  it("pages newest-first without gaps or repeats", async () => {
    const owner = await makeUser("page-owner");
    const trip = await createTrip(owner.accessToken, "Paging");

    // Five events sharing a timestamp would break a createdAt-only cursor; the
    // id tiebreak is what keeps the order total.
    const now = new Date();
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        tripId: trip.id,
        actorId: owner.user.id,
        action: "OPTION_LOCKED" as const,
        targetType: "OPTION",
        metadata: { optionTitle: `Option ${i}` },
        createdAt: now,
      })),
    });

    const first = await feed(owner.accessToken, trip.id, "?limit=2");
    assert.equal(first.events.length, 2);
    assert.ok(first.nextCursor);

    const second = await feed(
      owner.accessToken,
      trip.id,
      `?limit=2&cursor=${first.nextCursor}`,
    );
    assert.equal(second.events.length, 2);

    const third = await feed(
      owner.accessToken,
      trip.id,
      `?limit=2&cursor=${second.nextCursor}`,
    );
    assert.equal(third.events.length, 1);
    assert.equal(third.nextCursor, null, "the log is exhausted");

    const ids = [...first.events, ...second.events, ...third.events].map(
      (e) => e.id,
    );
    assert.equal(new Set(ids).size, 5, "no row appears twice");
  });

  it("keeps an event readable after the actor's account is anonymized", async () => {
    const owner = await makeUser("anon-owner");
    const grace = await makeUser("anon-grace");
    const trip = await createTrip(owner.accessToken, "Anonymized actor");
    await addMember(trip.id, grace.user.id, "GUEST");

    await http()
      .patch(`/trips/${trip.id}/members/${grace.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "PARTICIPANT" })
      .expect(200);

    // What GDPR erasure leaves behind (Phase 1.5) — the row is retained.
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { anonymizedAt: new Date() },
    });

    const page = await feed(grace.accessToken, trip.id);
    assert.equal(page.events.length, 1, "history outlives the account");
    assert.equal(page.events[0]?.actorName, null);
    // The target snapshot is unaffected — the event still says what happened.
    assert.equal(page.events[0]?.targetName, "anon-grace");
  });
});
