import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MAX_EMAIL_ATTEMPTS } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";
import { EmailService } from "../src/email/email.service.js";
import { EmailQueueService } from "../src/email/email-queue.service.js";
import { createUnsubscribeToken } from "../src/email/unsubscribe.token.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { MessagesService } from "../src/chat/messages.service.js";

/** One recorded delivery attempt against the mocked provider. */
interface SentMention {
  to: string;
  tripName: string;
  excerpt: string;
  unsubscribeToken: string;
}

/**
 * Async notification email (Phase 5.2) against a real DB — the slice's DoD:
 *
 *  - an @mention to an opted-in member enqueues **exactly one** job, which the
 *    worker sends once and never re-sends;
 *  - re-running fan-out for the same message enqueues nothing further (the
 *    idempotency guarantee, enforced by the `dedupeKey` UNIQUE index);
 *  - a muted trip, a disabled global toggle, or an unverified address enqueues
 *    nothing at all;
 *  - a failing provider retries with backoff and eventually parks the job as
 *    FAILED rather than looping;
 *  - the unsubscribe link works **logged-out**, is signature-checked, and
 *    silences only notification mail — transactional mail is unaffected.
 */
describe("Email queue (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let messages: MessagesService;
  let queue: EmailQueueService;
  let env: Env;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  /** Recorded sends + a switch to make the provider fail, for the retry path. */
  const sent: SentMention[] = [];
  const transactional: string[] = [];
  let failNextSends = false;

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
    sendMentionEmail: (input: SentMention) => {
      if (failNextSends) return Promise.reject(new Error("provider down"));
      sent.push(input);
      return Promise.resolve();
    },
  };

  async function makeUser(
    label: string,
    overrides: { emailVerified?: boolean; emailOnMention?: boolean } = {},
  ) {
    const email = `equeue+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: overrides.emailVerified ?? true,
        emailOnMention: overrides.emailOnMention ?? true,
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

  /**
   * A trip whose owner mentions `target` in the general channel. Returns the
   * message id so a test can re-run fan-out for the same event.
   */
  async function mention(
    label: string,
    target: { user: { id: string; displayName: string } },
    opts: { muted?: boolean } = {},
  ) {
    const owner = await makeUser(`${label}-owner`);
    const trip = await createTrip(owner.accessToken, `Queue ${label}`);
    await prisma.tripMembership.create({
      data: {
        tripId: trip.id,
        userId: target.user.id,
        role: "PARTICIPANT",
        muted: opts.muted ?? false,
      },
    });
    const channel = await prisma.channel.findFirstOrThrow({
      where: { tripId: trip.id, type: "GENERAL" },
    });
    const message = await messages.post(trip.id, owner.user.id, {
      channelId: channel.id,
      body: `@${target.user.displayName} please confirm the booking`,
    });
    return { owner, trip, channel, messageId: message.id };
  }

  const jobsFor = (userId: string) =>
    prisma.emailJob.findMany({ where: { userId } });

  /**
   * Sends addressed to one recipient. Test files run in parallel against the
   * same database, so a worker pass here may legitimately drain another suite's
   * queued jobs — every assertion is scoped to this test's own address rather
   * than to a global count.
   */
  const sentTo = (email: string) => sent.filter((s) => s.to === email);

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
    queue = app.get(EmailQueueService);
    env = app.get<Env>(ENV);
  });

  beforeEach(() => {
    sent.length = 0;
    transactional.length = 0;
    failNextSends = false;
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      // Jobs outlive their user (userId is SetNull), so clear them explicitly.
      await prisma.emailJob.deleteMany({ where: { userId: { in: ids } } });
      await prisma.trip.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("enqueues exactly one job per mention and sends it once", async () => {
    const alice = await makeUser("send-alice");
    const { trip } = await mention("send", alice);

    const queued = await jobsFor(alice.user.id);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]!.status, "PENDING");
    assert.equal(queued[0]!.to, alice.email);
    assert.equal(queued[0]!.type, "MENTION");

    await queue.processDueJobs();
    const delivered = sentTo(alice.email);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0]!.excerpt, /confirm the booking/);
    assert.equal(delivered[0]!.tripName, "Queue send");
    assert.ok(delivered[0]!.unsubscribeToken, "every email carries an opt-out");

    const afterSend = await jobsFor(alice.user.id);
    assert.equal(afterSend[0]!.status, "SENT");
    assert.ok(afterSend[0]!.sentAt);
    assert.equal(afterSend[0]!.attempts, 1);

    // A second pass must not re-send an already-sent email.
    await queue.processDueJobs();
    assert.equal(sentTo(alice.email).length, 1);
    assert.ok(trip.id);
  });

  it("stays at one job when fan-out runs again for the same message", async () => {
    const alice = await makeUser("dupe-alice");
    const { trip, messageId } = await mention("dupe", alice);
    assert.equal((await jobsFor(alice.user.id)).length, 1);

    // Simulate a redelivered/retried fan-out of the very same event.
    await queue.enqueueMentionEmails({
      tripId: trip.id,
      tripName: "Queue dupe",
      actorName: "dupe-owner",
      messageId,
      excerpt: "please confirm the booking",
      recipientIds: [alice.user.id],
    });

    const queued = await jobsFor(alice.user.id);
    assert.equal(
      queued.length,
      1,
      "dedupeKey must collapse the second enqueue",
    );

    await queue.processDueJobs();
    assert.equal(sentTo(alice.email).length, 1);
  });

  it("enqueues nothing when the recipient muted the trip", async () => {
    const alice = await makeUser("muted-alice");
    await mention("muted", alice, { muted: true });
    assert.deepEqual(await jobsFor(alice.user.id), []);
    await queue.processDueJobs();
    assert.equal(sentTo(alice.email).length, 0);
  });

  it("enqueues nothing when the global toggle is off", async () => {
    const alice = await makeUser("off-alice", { emailOnMention: false });
    await mention("off", alice);
    assert.deepEqual(await jobsFor(alice.user.id), []);
    assert.equal(sentTo(alice.email).length, 0);
  });

  it("never mails an unverified address", async () => {
    const alice = await makeUser("unver-alice", { emailVerified: false });
    await mention("unver", alice);
    assert.deepEqual(await jobsFor(alice.user.id), []);
  });

  it("still delivers the in-app notification when email is suppressed", async () => {
    // The in-app channel is always on — muting only silences email.
    const alice = await makeUser("inapp-alice", { emailOnMention: false });
    const { trip } = await mention("inapp", alice);
    const notes = await prisma.notification.findMany({
      where: { userId: alice.user.id, tripId: trip.id },
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.type, "MENTION");
  });

  it("retries a failed send with backoff, then parks it as FAILED", async () => {
    const alice = await makeUser("retry-alice");
    await mention("retry", alice);

    failNextSends = true;
    await queue.processDueJobs();

    const afterFail = (await jobsFor(alice.user.id))[0]!;
    assert.equal(afterFail.status, "PENDING", "retries remain");
    assert.equal(afterFail.attempts, 1);
    assert.equal(afterFail.claimedAt, null);
    assert.match(String(afterFail.lastError), /provider down/);
    assert.ok(
      afterFail.runAfter.getTime() > Date.now(),
      "backoff must push the next attempt into the future",
    );

    // Not due yet: a pass right now must leave it alone.
    await queue.processDueJobs();
    assert.equal((await jobsFor(alice.user.id))[0]!.attempts, 1);

    // Spend the remaining attempts: the next failure is the last one.
    await prisma.emailJob.update({
      where: { id: afterFail.id },
      data: { attempts: MAX_EMAIL_ATTEMPTS - 1, runAfter: new Date() },
    });
    await queue.processDueJobs();

    const parked = (await jobsFor(alice.user.id))[0]!;
    assert.equal(parked.status, "FAILED");
    assert.equal(parked.attempts, MAX_EMAIL_ATTEMPTS);
    assert.equal(sentTo(alice.email).length, 0);

    // A parked job is not picked up again.
    failNextSends = false;
    await queue.processDueJobs();
    assert.equal(sentTo(alice.email).length, 0);
    assert.equal((await jobsFor(alice.user.id))[0]!.status, "FAILED");
  });

  it("reclaims a job abandoned mid-send by a dead worker", async () => {
    const alice = await makeUser("stuck-alice");
    await mention("stuck", alice);
    const job = (await jobsFor(alice.user.id))[0]!;

    // What a worker that crashed between claiming and sending leaves behind.
    await prisma.emailJob.update({
      where: { id: job.id },
      data: {
        status: "SENDING",
        claimedAt: new Date(Date.now() - 60 * 60_000),
      },
    });

    await queue.processDueJobs();
    assert.equal(sentTo(alice.email).length, 1);
    assert.equal((await jobsFor(alice.user.id))[0]!.status, "SENT");
  });

  it("unsubscribes logged-out via the signed link, and then sends no more", async () => {
    const alice = await makeUser("unsub-alice");
    const token = createUnsubscribeToken(alice.user.id, env.JWT_SECRET);

    // No Authorization header anywhere in this flow — that is the point.
    const res = await http()
      .get(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .expect(200);
    assert.match(res.text, /unsubscribed/i);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: alice.user.id },
    });
    assert.equal(updated.emailOnMention, false);

    // The preference now suppresses the email channel end-to-end …
    await mention("unsub", alice);
    assert.deepEqual(await jobsFor(alice.user.id), []);

    // … and unsubscribing again is idempotent, not an error.
    await http()
      .post(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .expect(200);
  });

  it("rejects a tampered or missing unsubscribe token", async () => {
    const alice = await makeUser("tamper-alice");
    const valid = createUnsubscribeToken(alice.user.id, env.JWT_SECRET);
    const [payload] = valid.split(".");

    await http().get("/email/unsubscribe").expect(400);
    await http().get("/email/unsubscribe?token=nonsense").expect(400);
    // Right user, forged signature.
    await http()
      .get(`/email/unsubscribe?token=${payload}.deadbeef`)
      .expect(400);
    // Someone else's payload spliced onto this signature.
    const foreign = Buffer.from(
      "00000000-0000-0000-0000-000000000000",
    ).toString("base64url");
    await http()
      .get(`/email/unsubscribe?token=${foreign}.${valid.split(".")[1]}`)
      .expect(400);

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { id: alice.user.id },
    });
    assert.equal(untouched.emailOnMention, true, "a bad token changes nothing");
  });

  it("keeps transactional email flowing for an unsubscribed user", async () => {
    // FR-36: unsubscribing silences notifications, never account-critical mail.
    const alice = await makeUser("trans-alice", { emailOnMention: false });

    await http()
      .post("/auth/register")
      .send({
        email: alice.email,
        password: "Sup3rSecret!pass",
        displayName: "trans-alice",
      })
      .expect(201);

    assert.ok(
      transactional.includes(`exists:${alice.email}`),
      "transactional mail must ignore notification preferences",
    );
  });
});
