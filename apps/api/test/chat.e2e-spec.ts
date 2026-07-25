import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import type { TripRole } from "@prisma/client";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import {
  MESSAGE_DELETE_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_NEW_EVENT,
  MESSAGE_SEND_EVENT,
  type MessageAck,
  type MessageView,
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
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { TripsService } from "../src/trips/trips.service.js";

/**
 * Chat WebSocket gateway integration test (real DB + a real Socket.IO client).
 * Covers the Phase-4.1 DoD:
 * - a verified member's socket authenticates, joins the trip room, and receives
 *   the ready payload (its General channel);
 * - a non-member socket is rejected (the IDOR surface — never joins a trip it
 *   isn't part of);
 * - a blocked member's socket is rejected even with a valid token;
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
  async function makeTrip(
    ownerId: string,
    opts: { history?: boolean } = {},
  ) {
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

  /** Attempt a handshake; resolve with the ready payload or the rejection message. */
  function attempt(auth: {
    token: string;
    tripId: string;
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

    const result = await attempt({ token: owner.token, tripId: trip.id });
    assert.ok(result.ok, "member socket should connect");
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0]?.type, "GENERAL");
    assert.equal(result.channels[0]?.tripId, trip.id);
  });

  it("rejects a non-member socket (never joins a trip it isn't part of)", async () => {
    const owner = await makeUser("owner2");
    const outsider = await makeUser("outsider");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: outsider.token, tripId: trip.id });
    assert.equal(result.ok, false);
  });

  it("rejects a blocked member even with a valid token", async () => {
    const owner = await makeUser("owner3");
    const blocked = await makeUser("blocked");
    const trip = await makeTrip(owner.user.id);
    // A membership row AND a block row — the block must win.
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

    const result = await attempt({ token: blocked.token, tripId: trip.id });
    assert.equal(result.ok, false);
  });

  it("rejects a garbage token", async () => {
    const owner = await makeUser("owner4");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: "not-a-jwt", tripId: trip.id });
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

  it("tombstones on delete (Organizer any / author own) and rejects a non-author non-organizer", async () => {
    const owner = await makeUser("d-owner");
    const guest = await makeUser("d-guest");
    const parti = await makeUser("d-parti");
    const trip = await makeTrip(owner.user.id);
    await addMember(trip.id, guest.user.id, "GUEST");
    await addMember(trip.id, parti.user.id, "PARTICIPANT");
    const channelId = await generalChannelId(trip.id);

    const gsock = await connect({ token: guest.token, tripId: trip.id });
    const osock = await connect({ token: owner.token, tripId: trip.id });
    const psock = await connect({ token: parti.token, tripId: trip.id });

    // A Guest can post (chat is Guest+).
    const posted = await emitAck(gsock, MESSAGE_SEND_EVENT, {
      channelId,
      body: "guest here",
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
      gsock.on(MESSAGE_DELETED_EVENT, res),
    );
    const del = await emitAck(osock, MESSAGE_DELETE_EVENT, { messageId: msgId });
    assert.ok(del.ok);
    assert.equal(del.message.deleted, true);
    assert.equal(del.message.body, null);
    const t = await tomb;
    assert.equal(t.id, msgId);
    assert.equal(t.deleted, true);
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
        data: { channelId, authorId: owner.user.id, body, createdAt: new Date(base) },
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
  });

  it("catches up messages since a last-seen id (no gaps, no dupes)", async () => {
    const owner = await makeUser("since-owner");
    const trip = await makeTrip(owner.user.id);
    const channelId = await generalChannelId(trip.id);
    const sock = await connect({ token: owner.token, tripId: trip.id });

    const a1 = await emitAck(sock, MESSAGE_SEND_EVENT, { channelId, body: "a1" });
    const a2 = await emitAck(sock, MESSAGE_SEND_EVENT, { channelId, body: "a2" });
    const a3 = await emitAck(sock, MESSAGE_SEND_EVENT, { channelId, body: "a3" });
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
});
