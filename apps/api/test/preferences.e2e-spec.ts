import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { NotificationPreferences, TripMuteView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import { EmailService } from "../src/email/email.service.js";
import { createUnsubscribeToken } from "../src/email/unsubscribe.token.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { MessagesService } from "../src/chat/messages.service.js";

/**
 * Notification preferences + unsubscribe (Phase 5.3) against a real DB — the
 * slice's DoD, stated as behaviour rather than as state:
 *
 *  - flipping the **global** toggle changes whether a later mention queues mail;
 *  - flipping the **per-trip mute** does the same for that trip only, leaving
 *    the user's other trips alone;
 *  - the in-app notification is delivered either way — muting quiets the inbox,
 *    not the app;
 *  - one-click unsubscribe works **logged out** and lands on the SPA;
 *  - none of it can touch transactional mail, and none of it can be aimed at
 *    another account.
 */
describe("Notification preferences (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let messages: MessagesService;
  let env: Env;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  const transactional: string[] = [];

  const emailMock = {
    sendVerificationEmail: (to: string) => {
      transactional.push(`verify:${to}`);
      return Promise.resolve();
    },
    sendAccountExistsNotice: (to: string) => {
      transactional.push(`exists:${to}`);
      return Promise.resolve();
    },
    sendInviteEmail: (to: string) => {
      transactional.push(`invite:${to}`);
      return Promise.resolve();
    },
    // The worker may drain jobs mid-run; sending is covered by the queue suite.
    sendMentionEmail: () => Promise.resolve(),
  };

  async function makeUser(label: string) {
    const email = `prefs+${label}+${suffix}@example.com`;
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
    return res.body as { id: string; viewerMuted: boolean };
  }

  /** Owner mentions `target` in the trip's general channel. */
  async function mention(
    tripId: string,
    owner: { user: { id: string } },
    target: { user: { displayName: string } },
  ) {
    const channel = await prisma.channel.findFirstOrThrow({
      where: { tripId, type: "GENERAL" },
    });
    return messages.post(tripId, owner.user.id, {
      channelId: channel.id,
      body: `@${target.user.displayName} what do you think?`,
    });
  }

  const jobsFor = (userId: string) =>
    prisma.emailJob.count({ where: { userId } });

  before(async () => {
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
    env = app.get<Env>(ENV);
  });

  beforeEach(() => {
    transactional.length = 0;
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

  it("reads preferences, defaulted on", async () => {
    const alice = await makeUser("read");
    const res = await http()
      .get("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);
    assert.deepEqual(res.body as NotificationPreferences, {
      emailOnMention: true,
    });
  });

  it("requires a session to read or write preferences", async () => {
    await http().get("/account/preferences").expect(401);
    await http()
      .patch("/account/preferences")
      .send({ emailOnMention: false })
      .expect(401);
  });

  it("rejects an empty preferences update rather than silently doing nothing", async () => {
    const alice = await makeUser("empty");
    await http()
      .patch("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({})
      .expect(400);
  });

  it("turning the global toggle off stops mention email being queued", async () => {
    const owner = await makeUser("global-owner");
    const alice = await makeUser("global-alice");
    const trip = await createTrip(owner.accessToken, "Global toggle");
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: alice.user.id, role: "PARTICIPANT" },
    });

    // On by default → a mention queues one email.
    await mention(trip.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 1);

    const patched = await http()
      .patch("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ emailOnMention: false })
      .expect(200);
    assert.deepEqual(patched.body as NotificationPreferences, {
      emailOnMention: false,
    });

    // Off → the next mention queues nothing (still 1 from before, not 2).
    await mention(trip.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 1);

    // Back on → queueing resumes, so the toggle is genuinely two-way.
    await http()
      .patch("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ emailOnMention: true })
      .expect(200);
    await mention(trip.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 2);
  });

  it("muting one trip silences only that trip, and never the in-app bell", async () => {
    const owner = await makeUser("mute-owner");
    const alice = await makeUser("mute-alice");
    const noisy = await createTrip(owner.accessToken, "Noisy trip");
    const quiet = await createTrip(owner.accessToken, "Other trip");
    for (const trip of [noisy, quiet]) {
      await prisma.tripMembership.create({
        data: { tripId: trip.id, userId: alice.user.id, role: "PARTICIPANT" },
      });
    }

    const muted = await http()
      .post(`/trips/${noisy.id}/members/mute`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ muted: true })
      .expect(201);
    assert.deepEqual(muted.body as TripMuteView, {
      tripId: noisy.id,
      muted: true,
    });

    await mention(noisy.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 0, "muted trip queues no email");

    // The in-app channel is always on — that is the whole point of the split.
    const notes = await prisma.notification.count({
      where: { userId: alice.user.id, tripId: noisy.id },
    });
    assert.equal(notes, 1);

    // A different trip is unaffected by this trip's mute.
    await mention(quiet.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 1);

    // Unmuting restores email for the noisy trip.
    await http()
      .post(`/trips/${noisy.id}/members/mute`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ muted: false })
      .expect(201);
    await mention(noisy.id, owner, alice);
    assert.equal(await jobsFor(alice.user.id), 2);
  });

  it("surfaces the caller's own mute state on the trip, per-viewer", async () => {
    const owner = await makeUser("flag-owner");
    const alice = await makeUser("flag-alice");
    const trip = await createTrip(owner.accessToken, "Mute flag");
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: alice.user.id, role: "PARTICIPANT" },
    });

    await http()
      .post(`/trips/${trip.id}/members/mute`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ muted: true })
      .expect(201);

    const asAlice = await http()
      .get(`/trips/${trip.id}`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);
    assert.equal((asAlice.body as { viewerMuted: boolean }).viewerMuted, true);

    // One member's mute is theirs alone — the owner still sees it unmuted.
    const asOwner = await http()
      .get(`/trips/${trip.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal((asOwner.body as { viewerMuted: boolean }).viewerMuted, false);
  });

  it("lets a Guest mute their own membership (it is not an organizer action)", async () => {
    const owner = await makeUser("guest-owner");
    const guest = await makeUser("guest-member");
    const trip = await createTrip(owner.accessToken, "Guest mute");
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: guest.user.id, role: "GUEST" },
    });

    await http()
      .post(`/trips/${trip.id}/members/mute`)
      .set("Authorization", `Bearer ${guest.accessToken}`)
      .send({ muted: true })
      .expect(201);
  });

  it("cannot mute a trip the caller is not a member of", async () => {
    const owner = await makeUser("idor-owner");
    const outsider = await makeUser("idor-outsider");
    const trip = await createTrip(owner.accessToken, "Not yours");

    // 404, not 403 — a non-member is not told the trip exists.
    await http()
      .post(`/trips/${trip.id}/members/mute`)
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .send({ muted: true })
      .expect(404);

    const membership = await prisma.tripMembership.findFirst({
      where: { tripId: trip.id, userId: owner.user.id },
    });
    assert.equal(membership?.muted, false, "the owner's row is untouched");
  });

  it("one-click unsubscribe works logged out and lands on the SPA", async () => {
    const alice = await makeUser("landing");
    const token = createUnsubscribeToken(alice.user.id, env.JWT_SECRET);

    const res = await http()
      .get(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .expect(302);
    assert.equal(
      res.headers.location,
      `${env.WEB_APP_URL}/unsubscribed?status=ok`,
    );

    // The preference the settings screen reads is the one the link flipped.
    const prefs = await http()
      .get("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .expect(200);
    assert.deepEqual(prefs.body as NotificationPreferences, {
      emailOnMention: false,
    });
  });

  it("never lets a preference change block account-critical email", async () => {
    // FR-36: the transactional path does not read preferences at all.
    const alice = await makeUser("transactional");
    await http()
      .patch("/account/preferences")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ emailOnMention: false })
      .expect(200);

    await http()
      .post("/auth/register")
      .send({
        email: alice.email,
        password: "Sup3rSecret!pass",
        displayName: "transactional",
      })
      .expect(201);

    assert.ok(transactional.includes(`exists:${alice.email}`));
  });
});
