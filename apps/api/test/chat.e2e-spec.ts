import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { TripRole } from "@prisma/client";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import {
  CHANNEL_CREATED_EVENT,
  CHANNELS_DELETED_EVENT,
  MESSAGE_DELETE_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_NEW_EVENT,
  MESSAGE_SEND_EVENT,
  type MessageAck,
  type MessageView,
  OPTIONS_CHANGED_EVENT,
  type OptionsChanged,
  REACTION_ADD_EVENT,
  REACTION_REMOVE_EVENT,
  REACTION_UPDATED_EVENT,
  type ReactionAck,
  type ReactionUpdate,
  SOCKET_READY_EVENT,
  type ChannelView,
  type ChatReadyPayload,
} from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { MESSAGE_BURST } from "../src/common/throttle-policy.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { TripsService } from "../src/trips/trips.service.js";

/**
 * Chat WebSocket gateway integration test (real DB + a real Socket.IO client).
 * Covers the Phase-4.1 DoD:
 * - a verified member's socket authenticates, joins the trip room, and receives
 *   the ready payload (its General channel);
 * - a non-member connects but hears nothing about a board they are not on (the
 *   IDOR surface — the gate moved from the handshake to the room join when one
 *   socket started covering every board its owner is a member of);
 * - a blocked member is kept out of the board they were blocked from, even
 *   holding a live membership row;
 * - a garbage token is rejected;
 * - creating a trip auto-provisions its General channel.
 */
describe("Chat gateway (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;
  let port: number;
  const suffix = Date.now();
  const userIds: string[] = [];
  const tripIds: string[] = [];
  const opened: Socket[] = [];

  async function makeUser(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `chat+${label}+${suffix}@example.com`,
        displayName: label,
        emailVerified: true,
      },
    });
    userIds.push(user.id);
    const token = await tokens.signAccessToken(user);
    return { user, token };
  }

  /** A trip owned by `ownerId`, with the owner's membership + a General channel
   * (mirrors createTrip minimally, without seeding categories). */
  async function makeTrip(ownerId: string, opts: { history?: boolean } = {}) {
    const trip = await prisma.trip.create({
      data: {
        name: `Trip ${suffix}`,
        defaultCurrency: "EUR",
        status: opts.history ? "HISTORY" : "ACTIVE",
        expiresAt: new Date(Date.now() + (opts.history ? -1000 : 86_400_000)),
        ownerId,
      },
    });
    tripIds.push(trip.id);
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: ownerId, role: "OWNER" },
    });
    await prisma.channel.create({ data: { tripId: trip.id, type: "GENERAL" } });
    return trip;
  }

  async function addMember(tripId: string, userId: string, role: TripRole) {
    await prisma.tripMembership.create({ data: { tripId, userId, role } });
  }

  async function generalChannelId(tripId: string): Promise<string> {
    const c = await prisma.channel.findFirstOrThrow({
      where: { tripId, type: "GENERAL" },
    });
    return c.id;
  }

  /** Connect a socket and resolve once it has joined the trip room (ready). */
  function connect(auth: { token: string; tripId: string }): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`http://localhost:${port}`, {
        auth,
        transports: ["websocket"],
        reconnection: false,
      });
      opened.push(socket);
      socket.on(SOCKET_READY_EVENT, () => resolve(socket));
      socket.on("connect_error", (err: Error) => reject(err));
    });
  }

  /** Emit an event with an ack callback and resolve with the ack payload. */
  function emitAck(socket: Socket, event: string, payload: unknown) {
    return new Promise<MessageAck>((resolve) =>
      socket.emit(event, payload, resolve),
    );
  }

  /** Emit a reaction event and resolve with its ack. */
  function emitReaction(socket: Socket, event: string, payload: unknown) {
    return new Promise<ReactionAck>((resolve) =>
      socket.emit(event, payload, resolve),
    );
  }

  /** Connect and resolve with the socket + its ready payload (for unread). */
  function connectReady(auth: {
    token: string;
    tripId: string;
  }): Promise<{ socket: Socket; ready: ChatReadyPayload }> {
    return new Promise((resolve, reject) => {
      const socket = io(`http://localhost:${port}`, {
        auth,
        transports: ["websocket"],
        reconnection: false,
      });
      opened.push(socket);
      socket.on(SOCKET_READY_EVENT, (ready: ChatReadyPayload) =>
        resolve({ socket, ready }),
      );
      socket.on("connect_error", (err: Error) => reject(err));
    });
  }

  function unreadOf(ready: ChatReadyPayload, channelId: string): number {
    return ready.unread.find((u) => u.channelId === channelId)?.count ?? 0;
  }

  /** Resolve with the next `event` payload, or reject if it doesn't arrive. */
  function once<T>(socket: Socket, event: string, ms = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${event}`)),
        ms,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** A multi-select category with one PROPOSED option (for the lock-live test). */
  async function makeCategoryWithOption(tripId: string, proposerId: string) {
    const category = await prisma.category.create({
      data: { tripId, name: "Stay", position: 0, singleChoice: false },
    });
    const option = await prisma.option.create({
      data: {
        categoryId: category.id,
        proposerId,
        title: "Cabin",
        currency: "EUR",
        position: 0,
      },
    });
    return { category, option };
  }

  /** Attempt a handshake; resolve with the ready payload or the rejection message. */
  function attempt(auth: {
    token: string;
  }): Promise<
    { ok: true; channels: ChannelView[] } | { ok: false; message: string }
  > {
    return new Promise((resolve) => {
      const socket = io(`http://localhost:${port}`, {
        auth,
        transports: ["websocket"],
        reconnection: false,
      });
      socket.on(SOCKET_READY_EVENT, (payload: ChatReadyPayload) => {
        socket.disconnect();
        resolve({ ok: true, channels: payload.channels });
      });
      socket.on("connect_error", (err: Error) => {
        socket.disconnect();
        resolve({ ok: false, message: err.message });
      });
    });
  }

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    // A real port so the Socket.IO server attaches and a client can connect.
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  after(async () => {
    for (const s of opened) s.disconnect();
    // Queued mail outlives its user (`userId` is SetNull), so clear it first.
    await prisma.emailJob
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    // Trips cascade their memberships, channels, and blocks.
    for (const id of tripIds)
      await prisma.trip.deleteMany({ where: { id } }).catch(() => undefined);
    for (const id of userIds)
      await prisma.user.deleteMany({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("lets a member join and delivers the General channel", async () => {
    const owner = await makeUser("member");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: owner.token });
    assert.ok(result.ok, "member socket should connect");
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0]?.type, "GENERAL");
    assert.equal(result.channels[0]?.tripId, trip.id);
  });

  /*
   * The property these two guard did not change; where it is enforced did.
   *
   * A handshake used to name a trip, so "you are not on this board" could be a
   * refusal to connect at all. One socket now covers every board its owner is
   * on, and the handshake proves only who they are — so a stranger *does* get a
   * connection, and what they must not get is the board. Asserting
   * `connect_error` here would be asserting the old mechanism; asserting that
   * the trip's channels are absent from their payload is the thing that
   * actually matters, and it stays true however the gate is built.
   */
  it("gives a non-member a socket, and none of a board they are not on", async () => {
    const owner = await makeUser("owner2");
    const outsider = await makeUser("outsider");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: outsider.token });
    assert.equal(result.ok, true, "a signed-in stranger still connects");
    assert.ok(
      result.ok && result.channels.every((c) => c.tripId !== trip.id),
      "but hears nothing about a board they are not a member of",
    );
  });

  it("keeps a blocked member out of the board they were blocked from", async () => {
    const owner = await makeUser("owner3");
    const blocked = await makeUser("blocked");
    const trip = await makeTrip(owner.user.id);
    // A membership row AND a block row — the block must win (FR-17).
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: blocked.user.id, role: "PARTICIPANT" },
    });
    await prisma.tripBlock.create({
      data: {
        tripId: trip.id,
        userId: blocked.user.id,
        blockedById: owner.user.id,
      },
    });

    const result = await attempt({ token: blocked.token });
    assert.equal(result.ok, true);
    assert.ok(
      result.ok && result.channels.every((c) => c.tripId !== trip.id),
      "a live membership row does not outrank a block",
    );
  });

  it("carries every board the reader is on, over one connection", async () => {
    // The point of the whole change: a conversation stopped being a property of
    // the page you are standing on.
    const owner = await makeUser("multi");
    const one = await makeTrip(owner.user.id);
    const two = await makeTrip(owner.user.id);

    const result = await attempt({ token: owner.token });
    assert.equal(result.ok, true);
    assert.ok(
      result.ok && result.channels.some((c) => c.tripId === one.id),
      "the first board's channels are there",
    );
    assert.ok(
      result.ok && result.channels.some((c) => c.tripId === two.id),
      "and so are the second's, without a second socket",
    );
  });

  it("rejects a garbage token", async () => {
    // No trip to set up any more: the handshake's only question is who you are.
    const result = await attempt({ token: "not-a-jwt" });
    assert.equal(result.ok, false);
  });

  it("auto-creates a General channel when a trip is created", async () => {
    const creator = await makeUser("creator");
    const detail = await app
      .get(TripsService)
      .createTrip(creator.user, { name: "Auto trip", defaultCurrency: "EUR" });
    tripIds.push(detail.id);

    const channels = await prisma.channel.findMany({
      where: { tripId: detail.id },
    });
    assert.equal(channels.length, 1);
    assert.equal(channels[0]?.type, "GENERAL");
  });

  it("delivers a sent message live to another member and acks the sender", async () => {
    const owner = await makeUser("m-owner");
    const other = await makeUser("m-other");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, other.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const sender = await connect({ token: owner.token, tripId: trip.id });
    const receiver = await connect({ token: other.token, tripId: trip.id });

    const live = new Promise<MessageView>((res) =>
      receiver.on(MESSAGE_NEW_EVENT, res),
    );
    const ack = await emitAck(sender, MESSAGE_SEND_EVENT, {
      channelId,
      body: "hello crew",
    });
    assert.ok(ack.ok);
    assert.equal(ack.message.body, "hello crew");
    const delivered = await live;
    assert.equal(delivered.id, ack.message.id);
    assert.equal(delivered.body, "hello crew");
  });

  it("rate-limits a flood of messages per user, and lets a second user through (Phase 7.1)", async () => {
    // Socket events never passed through the HTTP ThrottlerGuard — it resolves
    // its request/response via `switchToHttp()`, which on a gateway hands back
    // the client and the payload — so message sending had no limit at all
    // until 7.1. This asserts the gateway's own per-user limiter.
    const owner = await makeUser("flood-owner");
    const other = await makeUser("flood-other");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, other.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const sock = await connect({ token: owner.token, tripId: trip.id });

    // Send strictly more than the budget allows, in order.
    const acks: MessageAck[] = [];
    for (let i = 0; i < MESSAGE_BURST + 5; i += 1) {
      acks.push(
        await emitAck(sock, MESSAGE_SEND_EVENT, {
          channelId,
          body: `flood ${i}`,
        }),
      );
    }

    const accepted = acks.filter((a) => a.ok).length;
    const refused = acks.filter((a) => !a.ok);
    assert.equal(
      accepted,
      MESSAGE_BURST,
      "exactly the burst budget should be accepted",
    );
    assert.ok(refused.length > 0, "the overflow must be refused");
    // Refusal is a graceful ack, not a dropped connection: the client renders
    // a failed-send state and the socket stays usable.
    assert.match(refused[0]?.error ?? "", /too fast|slow down|rate/i);
    assert.equal(sock.connected, true, "the socket must survive being limited");

    // The limit is per user, not global: a different member is unaffected.
    const second = await connect({ token: other.token, tripId: trip.id });
    const ok = await emitAck(second, MESSAGE_SEND_EVENT, {
      channelId,
      body: "unaffected",
    });
    assert.ok(ok.ok, "another user must not inherit the flooder's budget");
  });

  it("tombstones on delete (Organizer any / author own) and rejects a non-author non-organizer", async () => {
    const owner = await makeUser("d-owner");
    const author = await makeUser("d-author");
    const parti = await makeUser("d-parti");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, author.user.id, "PARTICIPANT");
    await addMember(trip.id, parti.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const asock = await connect({ token: author.token, tripId: trip.id });
    const osock = await connect({ token: owner.token, tripId: trip.id });
    const psock = await connect({ token: parti.token, tripId: trip.id });

    // The author was a Guest until post-launch, when Guest lost chat entirely
    // (`message.post`). It is a Participant now — the rule under test is about
    // authorship, not rank, and it needs an author who is allowed to write.
    const posted = await emitAck(asock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "author here",
    });
    assert.ok(posted.ok);
    const msgId = posted.message.id;

    // A Participant who isn't the author and isn't an Organizer cannot delete.
    const denied = await emitAck(psock, MESSAGE_DELETE_EVENT, {
      messageId: msgId,
    });
    assert.equal(denied.ok, false);

    // The Owner (Organizer) deletes anyone's; the tombstone broadcasts.
    const tomb = new Promise<MessageView>((res) =>
      asock.on(MESSAGE_DELETED_EVENT, res),
    );
    const del = await emitAck(osock, MESSAGE_DELETE_EVENT, {
      messageId: msgId,
    });
    assert.ok(del.ok);
    assert.equal(del.message.deleted, true);
    assert.equal(del.message.body, null);
    const t = await tomb;
    assert.equal(t.id, msgId);
    assert.equal(t.deleted, true);

    // Who cleared it, so the room can tell moderation from a retraction. The
    // *id* is what carries that distinction — the client compares it with the
    // author's rather than trusting a flag, so this has to be the real one and
    // not merely a name that happens to differ.
    assert.equal(t.deletedById, owner.user.id);
    assert.equal(t.deletedByName, owner.user.displayName);
    assert.notEqual(t.deletedById, t.authorId);
  });

  it("attributes a message its own author took back", async () => {
    const owner = await makeUser("dself-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    const sock = await connect({ token: owner.token, tripId: trip.id });

    const posted = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "second thoughts",
    });
    assert.ok(posted.ok);
    const del = await emitAck(sock, MESSAGE_DELETE_EVENT, {
      messageId: posted.message.id,
    });
    assert.ok(del.ok);
    assert.equal(del.message.deletedById, del.message.authorId);
    assert.equal(del.message.deletedByName, owner.user.displayName);
  });

  it("says nothing about a deleter on a live message", async () => {
    // The columns are null until the delete, and this asserts the mapper keeps
    // it that way: a stamp set early would tell the room an organizer is about
    // to remove something.
    const owner = await makeUser("dlive-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    const sock = await connect({ token: owner.token, tripId: trip.id });

    const posted = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "still here",
    });
    assert.ok(posted.ok);
    assert.equal(posted.message.deletedById, null);
    assert.equal(posted.message.deletedByName, null);
  });

  it("allows posting in a History trip (chat is exempt from the freeze)", async () => {
    const owner = await makeUser("hist-owner");
    const trip = await makeTrip(owner.user.id, { history: true });
    const channelId = await generalChannelId(trip.id);
    const sock = await connect({ token: owner.token, tripId: trip.id });

    const ack = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "still chatting after the trip",
    });
    assert.ok(ack.ok);
  });

  it("pages channel history newest-first by cursor (REST)", async () => {
    const owner = await makeUser("cursor-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    // Explicit increasing createdAt so the order is deterministic.
    let base = Date.now() - 10_000;
    for (const body of ["m1", "m2", "m3"]) {
      await prisma.message.create({
        data: {
          channelId,
          authorId: owner.user.id,
          body,
          createdAt: new Date(base),
        },
      });
      base += 1000;
    }

    const first = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/channels/${channelId}/messages?limit=2`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.equal(first.body.messages.length, 2);
    assert.equal(first.body.messages[0].body, "m3"); // newest first
    assert.equal(first.body.messages[1].body, "m2");
    assert.ok(first.body.nextCursor);

    const second = await request(app.getHttpServer())
      .get(
        `/trips/${trip.id}/channels/${channelId}/messages?limit=2&cursor=${first.body.nextCursor}`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.equal(second.body.messages.length, 1);
    assert.equal(second.body.messages[0].body, "m1");
    assert.equal(second.body.nextCursor, null);
  });

  it("adds and removes reactions live with public counts", async () => {
    const owner = await makeUser("react-owner");
    const other = await makeUser("react-other");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, other.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const s1 = await connect({ token: owner.token, tripId: trip.id });
    const s2 = await connect({ token: other.token, tripId: trip.id });

    const posted = await emitAck(s1, MESSAGE_SEND_EVENT, {
      channelId,
      body: "react to me",
    });
    assert.ok(posted.ok);
    const messageId = posted.message.id;

    const liveUpdate = new Promise<ReactionUpdate>((res) =>
      s2.on(REACTION_UPDATED_EVENT, res),
    );
    const add = await emitReaction(s1, REACTION_ADD_EVENT, {
      messageId,
      emoji: "👍",
    });
    assert.ok(add.ok);
    assert.equal(add.update.reactions.length, 1);
    assert.equal(add.update.reactions[0]?.emoji, "👍");
    assert.deepEqual(add.update.reactions[0]?.userIds, [owner.user.id]);

    const delivered = await liveUpdate;
    assert.equal(delivered.messageId, messageId);
    assert.deepEqual(delivered.reactions[0]?.userIds, [owner.user.id]);

    // Idempotent re-add keeps count 1; then removing clears the group.
    const readd = await emitReaction(s1, REACTION_ADD_EVENT, {
      messageId,
      emoji: "👍",
    });
    assert.ok(readd.ok);
    assert.equal(readd.update.reactions[0]?.userIds.length, 1);

    const remove = await emitReaction(s1, REACTION_REMOVE_EVENT, {
      messageId,
      emoji: "👍",
    });
    assert.ok(remove.ok);
    assert.equal(remove.update.reactions.length, 0);
  });

  it("resolves @mentions to members, persists targets, and ignores non-members", async () => {
    const owner = await makeUser("MentionOwner");
    const ada = await makeUser("AdaMentioned");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, ada.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const sock = await connect({ token: owner.token, tripId: trip.id });
    const ack = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "hey @AdaMentioned and @Ghost, look here",
    });
    assert.ok(ack.ok);
    // Only the real member is mentioned; @Ghost is ignored.
    assert.equal(ack.message.mentions.length, 1);
    assert.equal(ack.message.mentions[0]?.userId, ada.user.id);

    // The mention target is persisted for Phase-5 notification delivery.
    const rows = await prisma.mention.findMany({
      where: { messageId: ack.message.id },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.userId, ada.user.id);

    // …and the delivery itself, both channels, from the socket the browser
    // actually uses. The queue's own suite proves this from `messages.post`;
    // what was never covered was the step in front of it, which is the one
    // production runs. "Why did no email arrive?" is not a question a passing
    // test one layer down can answer.
    const notifications = await prisma.notification.findMany({
      where: { userId: ada.user.id, tripId: trip.id, type: "MENTION" },
    });
    assert.equal(notifications.length, 1, "the mentioned member is notified");

    const jobs = await prisma.emailJob.findMany({
      where: { userId: ada.user.id, type: "MENTION" },
    });
    assert.equal(jobs.length, 1, "and an email is queued for them");
    assert.equal(jobs[0]?.to, ada.user.email);

    // Never the author, on either channel — the rule that makes a self-mention
    // a no-op, and the reason the composer no longer offers your own name.
    assert.equal(
      await prisma.notification.count({
        where: { userId: owner.user.id, tripId: trip.id, type: "MENTION" },
      }),
      0,
    );
    assert.equal(
      await prisma.emailJob.count({ where: { userId: owner.user.id } }),
      0,
    );
  });

  it("catches up messages since a last-seen id (no gaps, no dupes)", async () => {
    const owner = await makeUser("since-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    const sock = await connect({ token: owner.token, tripId: trip.id });

    const a1 = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "a1",
    });
    const a2 = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "a2",
    });
    const a3 = await emitAck(sock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "a3",
    });
    assert.ok(a1.ok && a2.ok && a3.ok);

    const since1 = await request(app.getHttpServer())
      .get(
        `/trips/${trip.id}/channels/${channelId}/messages/since?after=${a1.message.id}`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    // Exactly the two after the anchor, oldest-first, anchor excluded.
    assert.deepEqual(
      (since1.body as { body: string }[]).map((m) => m.body),
      ["a2", "a3"],
    );

    const since3 = await request(app.getHttpServer())
      .get(
        `/trips/${trip.id}/channels/${channelId}/messages/since?after=${a3.message.id}`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.equal(since3.body.length, 0);
  });

  it("renders a parameterised error message, values and all", async () => {
    // The one end-to-end proof that the localizing exception filter is wired up.
    // This message is a *pattern* — "Invalid {name}" — thrown with its value
    // beside it rather than baked in, so that a translator has something to
    // translate. Which means the reader only ever sees a finished sentence if the
    // filter ran: without it the response body would carry the raw pattern and a
    // separate `params` object, and the board would print "Invalid {name}".
    const owner = await makeUser("badanchor");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);

    const res = await request(app.getHttpServer())
      .get(
        `/trips/${trip.id}/channels/${channelId}/messages/since?after=not-an-id`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(400);

    assert.equal((res.body as { message: string }).message, "Invalid after");
    // Still Nest's own error shape — the filter rewrites the prose and nothing
    // else, because the status and the error name are protocol rather than words.
    assert.equal((res.body as { statusCode: number }).statusCode, 400);
    assert.equal((res.body as { error?: string }).error, "Bad Request");
  });

  it("answers an English reader exactly as it did before", async () => {
    // Every exception in the app now passes through a filter that may rewrite its
    // message. For the source language that has to be the identity — this is the
    // regression guard for the other 57 messages, which have no translation to
    // exercise yet and would fail silently if the filter mangled them.
    //
    // A *channel* that does not exist, not a trip that does not: a non-member
    // asking about someone else's trip is answered with Express's own
    // "Cannot GET /trips/…" so that membership cannot be probed, which makes that
    // route the one place in the app where the message is deliberately not ours.
    const owner = await makeUser("englishreader");
    const trip = await makeTrip(owner.user.id);

    const res = await request(app.getHttpServer())
      .get(
        `/trips/${trip.id}/channels/00000000-0000-4000-8000-000000000000/messages`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .set("Accept-Language", "en-GB,en;q=0.9")
      .expect(404);
    assert.equal(
      (res.body as { message: string }).message,
      "Channel not found",
    );
    assert.equal((res.body as { error: string }).error, "Not Found");
  });

  it("counts unread from others and clears it on mark-read", async () => {
    const owner = await makeUser("unread-owner");
    const other = await makeUser("unread-other");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, other.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    // `other` posts two messages; `owner` has never read the channel.
    const os = await connect({ token: other.token, tripId: trip.id });
    await emitAck(os, MESSAGE_SEND_EVENT, { channelId, body: "u1" });
    await emitAck(os, MESSAGE_SEND_EVENT, { channelId, body: "u2" });

    const first = await connectReady({ token: owner.token, tripId: trip.id });
    assert.equal(unreadOf(first.ready, channelId), 2);

    // Owner marks read, then `other` posts one more.
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels/${channelId}/read`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(204);
    await emitAck(os, MESSAGE_SEND_EVENT, { channelId, body: "u3" });

    // A fresh connect reflects only the message posted after the read cursor,
    // and owner's own messages never count toward their unread.
    await emitAck(first.socket, MESSAGE_SEND_EVENT, {
      channelId,
      body: "my own",
    });
    const second = await connectReady({ token: owner.token, tripId: trip.id });
    assert.equal(unreadOf(second.ready, channelId), 1);
  });

  it("says when each channel was last spoken in, ignoring deleted messages", async () => {
    // What the switcher orders on. The server states the fact and stays
    // order-agnostic; the ordering rule itself is the client's.
    const owner = await makeUser("lastmsg-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);

    const empty = await connectReady({ token: owner.token, tripId: trip.id });
    assert.equal(
      empty.ready.channels.find((c) => c.id === channelId)?.lastMessageAt,
      null,
      "a channel nobody has written in has no last message",
    );

    const said = await emitAck(empty.socket, MESSAGE_SEND_EVENT, {
      channelId,
      body: "first thing",
    });
    assert.ok(said.ok);
    const spoken = await connectReady({ token: owner.token, tripId: trip.id });
    assert.equal(
      spoken.ready.channels.find((c) => c.id === channelId)?.lastMessageAt,
      said.message.createdAt,
    );

    // Taking it back leaves the channel with nothing said in it again — a
    // tombstone is not a conversation.
    await emitAck(spoken.socket, MESSAGE_DELETE_EVENT, {
      messageId: said.message.id,
    });
    const withdrawn = await connectReady({
      token: owner.token,
      tripId: trip.id,
    });
    assert.equal(
      withdrawn.ready.channels.find((c) => c.id === channelId)?.lastMessageAt,
      null,
    );
  });

  it("starts a category discussion on demand (idempotent) and broadcasts it live", async () => {
    const owner = await makeUser("disc-owner");
    const trip = await makeTrip(owner.user.id);
    const category = await prisma.category.create({
      data: { tripId: trip.id, name: "Transport", position: 0 },
    });

    // A connected member should see the new channel appear live.
    const watcher = await connect({ token: owner.token, tripId: trip.id });
    const broadcast = once<ChannelView>(watcher, CHANNEL_CREATED_EVENT);

    const first = await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ categoryId: category.id })
      .expect(201);
    assert.equal(first.body.type, "CATEGORY");
    assert.equal(first.body.categoryId, category.id);

    const pushed = await broadcast;
    assert.equal(pushed.id, first.body.id);
    assert.equal(pushed.type, "CATEGORY");

    // Idempotent: a second "start discussion" returns the same channel, no dupe.
    const second = await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ categoryId: category.id })
      .expect(201);
    assert.equal(second.body.id, first.body.id);
    const rows = await prisma.channel.findMany({
      where: { categoryId: category.id },
    });
    assert.equal(rows.length, 1);
  });

  it("cascades a category's channel when the category is deleted", async () => {
    const owner = await makeUser("cascade-owner");
    const trip = await makeTrip(owner.user.id);
    const category = await prisma.category.create({
      data: { tripId: trip.id, name: "Food", position: 0 },
    });
    await prisma.channel.create({
      data: { tripId: trip.id, categoryId: category.id, type: "CATEGORY" },
    });

    await prisma.category.delete({ where: { id: category.id } });

    const gone = await prisma.channel.findUnique({
      where: { categoryId: category.id },
    });
    assert.equal(gone, null);
  });

  it("pushes options:changed to trip viewers when an option is locked", async () => {
    const owner = await makeUser("lock-owner");
    const trip = await makeTrip(owner.user.id);
    const { category, option } = await makeCategoryWithOption(
      trip.id,
      owner.user.id,
    );

    const watcher = await connect({ token: owner.token, tripId: trip.id });
    const changed = once<OptionsChanged>(watcher, OPTIONS_CHANGED_EVENT);

    await request(app.getHttpServer())
      .post(
        `/trips/${trip.id}/categories/${category.id}/options/${option.id}/lock`,
      )
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        optionVersion: option.version,
        categoryVersion: category.version,
      })
      .expect(201);

    const payload = await changed;
    assert.equal(payload.tripId, trip.id);
    assert.equal(payload.categoryId, category.id);
  });

  it("rejects starting a discussion for a non-member (IDOR) and a foreign category", async () => {
    const owner = await makeUser("sd-owner");
    const outsider = await makeUser("sd-outsider");
    const trip = await makeTrip(owner.user.id);
    const category = await prisma.category.create({
      data: { tripId: trip.id, name: "Activities", position: 0 },
    });

    // A non-member gets a 404 (existence not leaked), never a channel.
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels`)
      .set("Authorization", `Bearer ${outsider.token}`)
      .send({ categoryId: category.id })
      .expect(404);

    // A category from another trip is a 404 too (no cross-trip channel).
    const other = await makeUser("sd-other");
    const otherTrip = await makeTrip(other.user.id);
    const foreign = await prisma.category.create({
      data: { tripId: otherTrip.id, name: "Elsewhere", position: 0 },
    });
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ categoryId: foreign.id })
      .expect(404);
  });

  /**
   * A Guest has no chat at all (post-launch), and this is the case that proves
   * it is a rule rather than a hidden button.
   *
   * Four surfaces, because "remove the chat permission" is only true if every
   * one of them refuses: the HTTP transcript, the socket's send, the socket's
   * *broadcast* (a Guest must not merely be unable to write — they must not
   * receive what others write), and the ready payload that lists the channels.
   *
   * The socket itself still connects. That is deliberate and is the thing most
   * likely to be "tidied" later: the same connection carries the board's own
   * live events, which are exactly what the role is for.
   */
  it("gives a Guest no chat: no transcript, no send, no broadcast", async () => {
    const owner = await makeUser("gc-owner");
    const guest = await makeUser("gc-guest");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, guest.user.id, "GUEST");
    const channelId = await generalChannelId(trip.id);

    // The transcript, over HTTP. These routes were guarded by `trip.view`,
    // which a Guest holds — so without a `message.read` row of its own the
    // whole conversation was one GET away.
    await request(app.getHttpServer())
      .get(`/trips/${trip.id}/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${guest.token}`)
      .expect(403);

    // Starting a discussion, which is a chat action and not an organizer one.
    const category = await prisma.category.create({
      data: { tripId: trip.id, name: "Food", position: 0 },
    });
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ categoryId: category.id })
      .expect(403);

    // The socket connects — the board's own events are what the role is for —
    // and its ready payload names no channels.
    const { socket: gsock, ready } = await connectReady({
      token: guest.token,
      tripId: trip.id,
    });
    assert.deepEqual(ready.channels, []);
    assert.deepEqual(ready.unread, []);

    // Sending is refused by an ordinary ack, not a dropped connection.
    const denied = await emitAck(gsock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "let me in",
    });
    assert.equal(denied.ok, false);

    // And nothing anyone else says reaches them. Asserted by racing the
    // broadcast against the owner's own ack: the ack only resolves after the
    // server has emitted, so a message that was going to arrive has had its
    // chance by then.
    let heard = false;
    gsock.on(MESSAGE_NEW_EVENT, () => {
      heard = true;
    });
    const osock = await connect({ token: owner.token, tripId: trip.id });
    const posted = await emitAck(osock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "organizers only",
    });
    assert.ok(posted.ok);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(heard, false, "a Guest must not receive chat broadcasts");
  });

  /**
   * Searching the board's transcript.
   *
   * The three that matter: it crosses channels (which is the whole reason it is
   * trip-scoped), it never surfaces a deleted message, and it treats the
   * reader's text as text — a search for "%" is a search for a percent sign,
   * not a request for the entire history.
   */
  it("finds a message in any of the board's channels, newest first", async () => {
    const owner = await makeUser("search-owner");
    const trip = await makeTrip(owner.user.id);
    const general = await generalChannelId(trip.id);
    const category = await prisma.category.create({
      data: { tripId: trip.id, name: "Stay", position: 0 },
    });
    const lane = await prisma.channel.create({
      data: { tripId: trip.id, type: "CATEGORY", categoryId: category.id },
    });

    let base = Date.now() - 10_000;
    const write = async (channelId: string, body: string) => {
      const row = await prisma.message.create({
        data: {
          channelId,
          authorId: owner.user.id,
          body,
          createdAt: new Date(base),
        },
      });
      base += 1000;
      return row;
    };
    await write(general, "the AIRPORT transfer is booked");
    await write(lane.id, "airport is 40 minutes away");
    await write(general, "nothing to do with it");
    const gone = await write(general, "airport, but withdrawn");
    await prisma.message.update({
      where: { id: gone.id },
      data: { deletedAt: new Date(), deletedById: owner.user.id },
    });

    const res = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/messages/search?q=airport`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    const bodies = (res.body.messages as MessageView[]).map((m) => m.body);
    // Case-insensitive, both channels, newest first, and the tombstone absent —
    // a deleted message has no body to match, and returning one would be a way
    // to read around a deletion.
    assert.deepEqual(bodies, [
      "airport is 40 minutes away",
      "the AIRPORT transfer is booked",
    ]);
    assert.equal(res.body.truncated, false);
    const channels = new Set(
      (res.body.messages as MessageView[]).map((m) => m.channelId),
    );
    assert.equal(channels.size, 2);
  });

  it("treats a LIKE wildcard as text, not as a wildcard", async () => {
    // The bug this exists for: Prisma's `contains` interpolates the term into
    // the pattern unescaped, so LIKE reads the reader's own punctuation as
    // wildcards. Both terms below are chosen to tell the two apart: escaped they
    // match one message each way, unescaped they would drag the decoy in.
    const owner = await makeUser("search-wildcard");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    for (const body of ["a 50% deposit", "10 people are coming"]) {
      await prisma.message.create({
        data: { channelId, authorId: owner.user.id, body },
      });
    }

    // Escaped, "0%" is a zero followed by a percent sign. Unescaped it is
    // "a zero, then anything", which "10 people are coming" also satisfies.
    const percent = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/messages/search?q=0%25`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.deepEqual(
      (percent.body.messages as MessageView[]).map((m) => m.body),
      ["a 50% deposit"],
    );

    // `_` is LIKE's single-character wildcard, so unescaped "50_" would match
    // the percent sign in "a 50% deposit". Nothing contains it literally.
    const underscore = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/messages/search?q=50_`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.equal(underscore.body.messages.length, 0);
  });

  it("answers an empty box with nothing rather than with everything", async () => {
    const owner = await makeUser("search-empty");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    await prisma.message.create({
      data: { channelId, authorId: owner.user.id, body: "something" },
    });

    for (const q of ["", "%20%20", "a"]) {
      const res = await request(app.getHttpServer())
        .get(`/trips/${trip.id}/messages/search?q=${q}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .expect(200);
      assert.deepEqual(res.body, { messages: [], truncated: false });
    }
  });

  it("refuses the transcript to a Guest, who has no chat at all", async () => {
    const owner = await makeUser("search-guard-owner");
    const guest = await makeUser("search-guard-guest");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, guest.user.id, "GUEST");
    const channelId = await generalChannelId(trip.id);
    await prisma.message.create({
      data: { channelId, authorId: owner.user.id, body: "organizers only" },
    });

    await request(app.getHttpServer())
      .get(`/trips/${trip.id}/messages/search?q=organizers`)
      .set("Authorization", `Bearer ${guest.token}`)
      .expect(403);
  });
  /**
   * Muting a board's chat.
   *
   * The three that matter: a timed mute is stored as an instant and lapses by
   * itself, the ready payload carries it so the badges are right from the first
   * frame, and it is a different switch from the trip's email mute — which is
   * the whole reason it is a different column.
   */
  it("mutes for an hour, and says when that lapses", async () => {
    const owner = await makeUser("mute-hour");
    const trip = await makeTrip(owner.user.id);

    const before = Date.now();
    const res = await request(app.getHttpServer())
      .put(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ duration: "HOUR" })
      .expect(200);

    assert.equal(res.body.muted, true);
    const until = new Date(res.body.mutedUntil).getTime();
    // An instant an hour out, not a duration counted from some later "now".
    assert.ok(until >= before + 59 * 60_000, "at least an hour away");
    assert.ok(until <= Date.now() + 61 * 60_000, "not much more than an hour");
  });

  it("mutes until lifted, with no expiry at all", async () => {
    const owner = await makeUser("mute-always");
    const trip = await makeTrip(owner.user.id);

    const res = await request(app.getHttpServer())
      .put(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ duration: "ALWAYS" })
      .expect(200);

    // The distinction the two columns exist for: muted, with nothing to expire.
    assert.deepEqual(res.body, { muted: true, mutedUntil: null });
  });

  it("lifts the mute when asked for no duration at all", async () => {
    const owner = await makeUser("mute-lift");
    const trip = await makeTrip(owner.user.id);
    const put = (duration: string | null) =>
      request(app.getHttpServer())
        .put(`/trips/${trip.id}/chat-mute`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ duration })
        .expect(200);

    await put("DAY");
    const lifted = await put(null);
    assert.deepEqual(lifted.body, { muted: false, mutedUntil: null });

    const read = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.deepEqual(read.body, { muted: false, mutedUntil: null });
  });

  it("reads a lapsed mute as no mute, without rewriting the row", async () => {
    const owner = await makeUser("mute-lapsed");
    const trip = await makeTrip(owner.user.id);
    // A mute that ran out a minute ago, as a socket connecting now would find.
    await prisma.tripMembership.updateMany({
      where: { tripId: trip.id, userId: owner.user.id },
      data: { chatMuted: true, chatMutedUntil: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer())
      .get(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    assert.deepEqual(res.body, { muted: false, mutedUntil: null });

    // Reading did not clear it: every socket connect would otherwise be a
    // write, and a row that says "muted until a moment in the past" already
    // means exactly what it needs to mean.
    const row = await prisma.tripMembership.findFirstOrThrow({
      where: { tripId: trip.id, userId: owner.user.id },
    });
    assert.equal(row.chatMuted, true);
  });

  it("is a different switch from the trip's email mute", async () => {
    // The reason for a second column rather than a reused one: a member may
    // want their inbox quiet and their badges live, or the reverse.
    const owner = await makeUser("mute-separate");
    const trip = await makeTrip(owner.user.id);
    await prisma.tripMembership.updateMany({
      where: { tripId: trip.id, userId: owner.user.id },
      data: { muted: true },
    });

    await request(app.getHttpServer())
      .put(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ duration: null })
      .expect(200);

    const row = await prisma.tripMembership.findFirstOrThrow({
      where: { tripId: trip.id, userId: owner.user.id },
    });
    assert.equal(row.muted, true, "lifting the chat mute left the email mute");
    assert.equal(row.chatMuted, false);
  });

  it("tells a connecting socket which boards are muted", async () => {
    const owner = await makeUser("mute-ready");
    const quiet = await makeTrip(owner.user.id);
    const loud = await makeTrip(owner.user.id);
    await request(app.getHttpServer())
      .put(`/trips/${quiet.id}/chat-mute`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ duration: "ALWAYS" })
      .expect(200);

    const { ready } = await connectReady({
      token: owner.token,
      tripId: quiet.id,
    });

    // Only the muted board is listed: an absent trip is an unmuted trip.
    assert.deepEqual(
      ready.mutes.map((m) => m.tripId),
      [quiet.id],
    );
    assert.equal(ready.mutes[0]?.mutedUntil, null);
    assert.ok(!ready.mutes.some((m) => m.tripId === loud.id));
  });

  it("refuses the mute to a Guest, who has no chat to silence", async () => {
    const owner = await makeUser("mute-guard-owner");
    const guest = await makeUser("mute-guard-guest");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, guest.user.id, "GUEST");

    await request(app.getHttpServer())
      .put(`/trips/${trip.id}/chat-mute`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ duration: "HOUR" })
      .expect(403);
  });
  /**
   * Deleting a board's discussions.
   *
   * The rule the owner set is the one worth pinning hardest: the trip-wide
   * channel is not deletable. Everything else here is the shape that rule lives
   * in — a set in one request, a board boundary the ids cannot cross, and the
   * messages going with the channel.
   */
  async function laneChannel(tripId: string, name: string) {
    const category = await prisma.category.create({
      data: { tripId, name, position: 0 },
    });
    return prisma.channel.create({
      data: { tripId, type: "CATEGORY", categoryId: category.id },
    });
  }

  it("deletes the discussions it was given, and their messages with them", async () => {
    const owner = await makeUser("del-owner");
    const trip = await makeTrip(owner.user.id);
    const stay = await laneChannel(trip.id, "Stay");
    await prisma.message.create({
      data: { channelId: stay.id, authorId: owner.user.id, body: "in here" },
    });

    const res = await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels/delete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ channelIds: [stay.id] })
      .expect(201);

    assert.deepEqual(res.body, [stay.id]);
    assert.equal(
      await prisma.channel.findUnique({ where: { id: stay.id } }),
      null,
    );
    // By FK cascade, the same one that takes a discussion when its category goes.
    assert.equal(
      await prisma.message.count({ where: { channelId: stay.id } }),
      0,
    );
  });

  it("refuses to delete the board's own conversation", async () => {
    const owner = await makeUser("del-general");
    const trip = await makeTrip(owner.user.id);
    const general = await generalChannelId(trip.id);
    const stay = await laneChannel(trip.id, "Stay");

    const res = await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels/delete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ channelIds: [stay.id, general] })
      .expect(400);
    assert.match(res.body.message, /can't be deleted/);

    // Refused, not partly done: the lane in the same request survives too.
    // Nothing recreates a General, so a half-applied delete here is the one
    // outcome there is no way back from.
    assert.ok(await prisma.channel.findUnique({ where: { id: general } }));
    assert.ok(await prisma.channel.findUnique({ where: { id: stay.id } }));
  });

  it("cannot reach a channel on another board", async () => {
    const owner = await makeUser("del-cross");
    const mine = await makeTrip(owner.user.id);
    const theirs = await makeTrip(owner.user.id);
    const stay = await laneChannel(theirs.id, "Stay");

    // Scoped by tripId in the same `where` that names the id, so an id from
    // elsewhere matches nothing rather than deleting somebody else's talk.
    const res = await request(app.getHttpServer())
      .post(`/trips/${mine.id}/channels/delete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ channelIds: [stay.id] })
      .expect(201);

    assert.deepEqual(res.body, []);
    assert.ok(await prisma.channel.findUnique({ where: { id: stay.id } }));
  });

  it("is refused to a member who cannot delete other people's messages", async () => {
    const owner = await makeUser("del-guard-owner");
    const traveler = await makeUser("del-guard-traveler");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, traveler.user.id, "PARTICIPANT");
    const stay = await laneChannel(trip.id, "Stay");

    // Deleting a discussion is deleting everyone's messages in it at once.
    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels/delete`)
      .set("Authorization", `Bearer ${traveler.token}`)
      .send({ channelIds: [stay.id] })
      .expect(403);
  });

  it("tells the room, so the chip goes from everyone's switcher", async () => {
    const owner = await makeUser("del-broadcast");
    const trip = await makeTrip(owner.user.id);
    const stay = await laneChannel(trip.id, "Stay");
    const socket = await connect({ token: owner.token, tripId: trip.id });
    const heard = once<{ channelIds: string[] }>(
      socket,
      CHANNELS_DELETED_EVENT,
    );

    await request(app.getHttpServer())
      .post(`/trips/${trip.id}/channels/delete`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ channelIds: [stay.id] })
      .expect(201);

    assert.deepEqual((await heard).channelIds, [stay.id]);
  });
});
