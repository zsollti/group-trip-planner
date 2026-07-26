import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { NotificationPage } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { MessagesService } from "../src/chat/messages.service.js";

/**
 * In-app notifications integration test (real DB) — the Phase-5.1 DoD:
 *  - each of the three triggers (propose, lock, `@mention`) creates rows for the
 *    **correct recipients** and **never the actor**;
 *  - a mention notifies only the mentioned member, not the whole trip;
 *  - the bell reads back newest-first with a correct unread count, and mark-read
 *    / mark-all-read are idempotent;
 *  - notifications are strictly user-scoped: another account's notification is a
 *    404, never readable or markable (the IDOR surface for this module).
 *
 * The live socket push is covered by the gateway test's room discipline; here we
 * assert the persisted side, which is what a recipient sees on load.
 */
describe("Notifications (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let messages: MessagesService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string) {
    const email = `notif+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    const accessToken = await tokens_.signAccessToken(user);
    return { user, accessToken, email };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body as { id: string };
  }

  /** Add a member straight through the DB (the invite flow is covered elsewhere). */
  async function addMember(
    tripId: string,
    userId: string,
    role: "CO_ORGANIZER" | "PARTICIPANT" | "GUEST" = "PARTICIPANT",
  ) {
    await prisma.tripMembership.create({ data: { tripId, userId, role } });
  }

  async function categories(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const byKey: Record<string, { id: string; version: number }> = {};
    for (const c of res.body as {
      id: string;
      version: number;
      builtinKey: string | null;
    }[]) {
      if (c.builtinKey) byKey[c.builtinKey] = { id: c.id, version: c.version };
    }
    return byKey;
  }

  function optionsUrl(tripId: string, categoryId: string) {
    return `/trips/${tripId}/categories/${categoryId}/options`;
  }

  async function propose(
    accessToken: string,
    tripId: string,
    categoryId: string,
    title: string,
  ) {
    const res = await http()
      .post(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title, currency: "EUR" })
      .expect(201);
    return res.body as { id: string; version: number };
  }

  async function bell(accessToken: string): Promise<NotificationPage> {
    const res = await http()
      .get("/notifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body as NotificationPage;
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
      // Mentions here also enqueue email (Phase 5.2); stub the send so a worker
      // pass during a long run is a no-op rather than a missing method.
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
    messages = app.get(MessagesService);
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      // Mention email jobs survive their user (userId is SetNull) — clear them.
      await prisma.emailJob.deleteMany({ where: { userId: { in: ids } } });
      await prisma.trip.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("notifies every other member when an option is proposed — never the actor", async () => {
    const owner = await makeUser("prop-owner");
    const alice = await makeUser("prop-alice");
    const bob = await makeUser("prop-bob");
    const trip = await createTrip(owner.accessToken, "Proposal fan-out");
    await addMember(trip.id, alice.user.id);
    await addMember(trip.id, bob.user.id);

    const cats = await categories(owner.accessToken, trip.id);
    await propose(alice.accessToken, trip.id, cats.TRANSPORT!.id, "FR1234");

    const ownerBell = await bell(owner.accessToken);
    assert.equal(ownerBell.unreadCount, 1);
    const first = ownerBell.notifications[0]!;
    assert.equal(first.type, "OPTION_PROPOSED");
    assert.equal(first.tripId, trip.id);
    assert.equal(first.actorName, "prop-alice");
    assert.equal(first.subject, "FR1234");
    assert.equal(first.categoryId, cats.TRANSPORT!.id);
    assert.equal(first.readAt, null);

    // Every other member got one …
    assert.equal((await bell(bob.accessToken)).unreadCount, 1);
    // … and the proposer got nothing (never notify the actor).
    assert.equal((await bell(alice.accessToken)).unreadCount, 0);
  });

  it("notifies the trip when a decision is locked", async () => {
    const owner = await makeUser("lock-owner");
    const alice = await makeUser("lock-alice");
    const trip = await createTrip(owner.accessToken, "Lock fan-out");
    await addMember(trip.id, alice.user.id);

    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.TRANSPORT!;
    const opt = await propose(
      owner.accessToken,
      trip.id,
      transport.id,
      "Night train",
    );
    await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: opt.version, categoryVersion: transport.version })
      .expect(201);

    const aliceBell = await bell(alice.accessToken);
    // The proposal (by the owner) and the lock (by the owner) — both to Alice.
    assert.equal(aliceBell.unreadCount, 2);
    assert.equal(aliceBell.notifications[0]?.type, "OPTION_LOCKED");
    assert.equal(aliceBell.notifications[0]?.subject, "Night train");
    // The locking organizer is not notified of their own decision.
    assert.equal((await bell(owner.accessToken)).unreadCount, 0);
  });

  it("notifies only the mentioned member on an @mention", async () => {
    const owner = await makeUser("men-owner");
    const alice = await makeUser("men-alice");
    const bob = await makeUser("men-bob");
    const trip = await createTrip(owner.accessToken, "Mention fan-out");
    await addMember(trip.id, alice.user.id);
    await addMember(trip.id, bob.user.id);
    const channel = await prisma.channel.findFirstOrThrow({
      where: { tripId: trip.id, type: "GENERAL" },
    });

    await messages.post(trip.id, owner.user.id, {
      channelId: channel.id,
      body: "@men-alice can you book this?",
    });

    const aliceBell = await bell(alice.accessToken);
    assert.equal(aliceBell.unreadCount, 1);
    assert.equal(aliceBell.notifications[0]?.type, "MENTION");
    assert.equal(aliceBell.notifications[0]?.channelId, channel.id);
    assert.match(aliceBell.notifications[0]!.subject, /book this/);
    // A mention is targeted: the rest of the trip hears nothing.
    assert.equal((await bell(bob.accessToken)).unreadCount, 0);
    assert.equal((await bell(owner.accessToken)).unreadCount, 0);
  });

  it("marks one read and all read, idempotently", async () => {
    const owner = await makeUser("read-owner");
    const alice = await makeUser("read-alice");
    const trip = await createTrip(owner.accessToken, "Mark read");
    await addMember(trip.id, alice.user.id);
    const cats = await categories(owner.accessToken, trip.id);
    await propose(alice.accessToken, trip.id, cats.ACCOMMODATION!.id, "Pizza");
    await propose(alice.accessToken, trip.id, cats.ACCOMMODATION!.id, "Ramen");

    const before_ = await bell(owner.accessToken);
    assert.equal(before_.unreadCount, 2);
    const target = before_.notifications[0]!.id;

    const first = await http()
      .post(`/notifications/${target}/read`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal((first.body as { unreadCount: number }).unreadCount, 1);

    // Marking the same one again is a no-op, not an error.
    const again = await http()
      .post(`/notifications/${target}/read`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal((again.body as { unreadCount: number }).unreadCount, 1);

    const all = await http()
      .post("/notifications/read-all")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal((all.body as { unreadCount: number }).unreadCount, 0);

    const after_ = await bell(owner.accessToken);
    assert.equal(after_.unreadCount, 0);
    assert.ok(after_.notifications.every((n) => n.readAt !== null));
  });

  it("keeps notifications private to their owner (404 across accounts)", async () => {
    const owner = await makeUser("idor-owner");
    const alice = await makeUser("idor-alice");
    const outsider = await makeUser("idor-outsider");
    const trip = await createTrip(owner.accessToken, "Private bell");
    await addMember(trip.id, alice.user.id);
    const cats = await categories(owner.accessToken, trip.id);
    await propose(alice.accessToken, trip.id, cats.ACTIVITIES!.id, "Kayaking");

    const ownerBell = await bell(owner.accessToken);
    const target = ownerBell.notifications[0]!.id;

    // Someone else's notification is invisible …
    assert.equal((await bell(outsider.accessToken)).notifications.length, 0);
    // … and unmarkable.
    await http()
      .post(`/notifications/${target}/read`)
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .expect(404);
    // The owner's own count is untouched by the attempt.
    assert.equal((await bell(owner.accessToken)).unreadCount, 1);
  });

  it("requires authentication", async () => {
    await http().get("/notifications").expect(401);
  });
});
