import { HttpException, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { TripRole } from "@prisma/client";
import {
  banIsActive,
  can,
  type ChatReadyPayload,
  DeleteMessageInput,
  MESSAGE_DELETE_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_NEW_EVENT,
  MESSAGE_SEND_EVENT,
  type MessageAck,
  REACTION_ADD_EVENT,
  REACTION_REMOVE_EVENT,
  REACTION_UPDATED_EVENT,
  ROOMS_REFRESH_EVENT,
  type ReactionAck,
  ReactionInput,
  type ReactionUpdate,
  SendMessageInput,
  SOCKET_READY_EVENT,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { SocketRateLimiter } from "../common/socket-rate-limiter.js";
import { MESSAGE_BURST, MESSAGE_WINDOW_MS } from "../common/throttle-policy.js";
import { chatRoom } from "../realtime/chat-room.js";
import { tripRoom } from "../realtime/trip-room.js";
import { userRoom } from "../realtime/user-room.js";
import { ChannelsService } from "./channels.service.js";
import { MessagesService } from "./messages.service.js";

export { tripRoom };

/**
 * What the gateway pins on an authenticated socket after the handshake.
 *
 * **The user, and nothing about any one trip.** A socket used to be scoped to a
 * board — one connection per open trip, with its id and the caller's role in it
 * pinned here. That made the chat a property of the page you were standing on:
 * to read the conversation on another board you had to go to it.
 *
 * The role is deliberately *not* cached alongside. It used to be, and the
 * comment this replaces said it was refreshed on every reconnect — true while a
 * socket lived as long as a page visit. A connection that now lasts as long as
 * the session would have carried a demotion for hours. Every action re-reads
 * the membership it depends on, which is what the REST guards do per request
 * and what the handshake below already claimed the discipline was.
 */
interface SocketData {
  userId: string;
}

/** Turn a thrown service error into the ack error string sent to the client. */
function ackError(err: unknown): string {
  return err instanceof HttpException ? err.message : "Something went wrong";
}

/**
 * The real-time gateway. **One Socket.IO connection per signed-in session**,
 * covering every board the reader belongs to.
 *
 * It was one connection per open trip, with the board's id in the handshake.
 * That made a conversation a property of the page: to read what was said on
 * another trip you had to navigate to it, which is the wrong shape for what
 * people actually do with several trips in flight at once. The handshake now
 * authenticates the *person*, and the socket joins the rooms of every trip they
 * are a member of.
 *
 * Authentication runs in a connection **middleware**, so an unauthorized socket
 * is rejected *during* the handshake (the client sees `connect_error`) rather
 * than connected-then-dropped. The discipline still mirrors the REST guards:
 * verify the access token, load the user fresh from the DB. What changed is
 * that membership is no longer a handshake-time question with a single answer
 * — it is asked per action, against the trip that action names (SRS FR-4).
 *
 * **Rooms are joined once and can go stale.** Membership moves while a session
 * is open: you join a board, or you are removed from one. The client emits
 * {@link ROOMS_REFRESH_EVENT} when its own trip list changes, which re-runs the
 * join — self-healing, and needing no server-side eventing to notice.
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly rateLimiter: SocketRateLimiter,
  ) {}

  afterInit(server: Server): void {
    // Reject unauthorized sockets at the handshake, before `connection` fires.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as Partial<SocketData>;
    // The middleware only calls next() after pinning it; this is defensive.
    if (!data.userId) {
      client.disconnect(true);
      return;
    }
    await client.join(userRoom(data.userId));
    await this.syncRooms(client, data.userId);
  }

  /**
   * Join the rooms of every board this reader is on, and say what is in them.
   *
   * Two kinds of room per trip, and the second is conditional: the trip's room
   * carries the board's own live events, the chat room carries the transcript,
   * which a Guest does not get. The user's own room, joined once on connect,
   * carries notifications about any of them (Phase 5.1). See
   * `realtime/chat-room`.
   *
   * Rooms are **left** as well as joined, which a per-trip socket never had to
   * think about: a connection that outlives a membership would otherwise go on
   * receiving a board's messages after the reader was removed from it.
   */
  private async syncRooms(client: Socket, userId: string): Promise<void> {
    const memberships = await this.readableMemberships(userId);
    const wanted = new Set<string>([userRoom(userId)]);
    for (const m of memberships) {
      wanted.add(tripRoom(m.tripId));
      if (can(m.role, "message.read")) wanted.add(chatRoom(m.tripId));
    }

    for (const room of client.rooms) {
      // Socket.IO puts every socket in a room named for its own id; leaving
      // that one would make the socket unaddressable.
      if (room === client.id || wanted.has(room)) continue;
      await client.leave(room);
    }
    for (const room of wanted) {
      await client.join(room);
    }

    // Only the boards whose transcript this reader may see. A payload naming a
    // channel they cannot read would answer a question they are not allowed to
    // ask, which is the same reason a Guest's payload used to be empty.
    const readable = memberships
      .filter((m) => can(m.role, "message.read"))
      .map((m) => m.tripId);
    // Annotated, and the annotation is load-bearing: `client.emit` takes `any`,
    // so nothing downstream compares this against the contract. The type is
    // what catches a payload built with the wrong field name in it.
    const payload: ChatReadyPayload = await this.channels.readyPayload(
      readable,
      userId,
    );
    client.emit(SOCKET_READY_EVENT, payload);
    this.logger.debug(`socket for ${userId} joined ${wanted.size} rooms`);
  }

  /**
   * Re-run the room join for a session whose membership has moved.
   *
   * Emitted by the client when its own trip list changes: it has just joined a
   * board, made one, or found one gone. Self-healing by design — the server
   * does not have to notice every path that can add or remove a membership (an
   * invite redemption, a removal, a block, an account-deletion cascade), and a
   * client that asks with no news simply gets the same rooms back.
   *
   * It reads the membership table, so it cannot be used to reach a board the
   * caller is not on.
   */
  @SubscribeMessage(ROOMS_REFRESH_EVENT)
  async onRoomsRefresh(@ConnectedSocket() client: Socket): Promise<void> {
    const data = client.data as SocketData;
    await this.syncRooms(client, data.userId);
  }

  /**
   * Every trip this user is a member of and not blocked from, with their role.
   *
   * The block check is belt-and-braces — a block ejects the membership row — but
   * it keeps the socket honest to FR-17 independently of that row, which is why
   * the handshake used to make it too.
   */
  private async readableMemberships(
    userId: string,
  ): Promise<{ tripId: string; role: TripRole }[]> {
    return this.prisma.tripMembership.findMany({
      where: { userId, trip: { blocks: { none: { userId } } } },
      select: { tripId: true, role: true },
    });
  }

  /**
   * Handshake gate. Throws on any failure so the connection middleware rejects
   * the socket; on success pins `{ userId }` for the room join above.
   *
   * It no longer asks which trip. A `tripId` in the handshake was the whole of
   * what made a socket per-board, and taking it out is what lets one connection
   * carry every conversation the reader is part of. Membership moved to where
   * it is actually needed — the action that names a trip.
   */
  private async authenticate(client: Socket): Promise<void> {
    const auth = client.handshake.auth as { token?: unknown };
    const token = typeof auth.token === "string" ? auth.token : "";
    if (!token) throw new Error("unauthorized");

    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      sub = payload.sub;
    } catch {
      throw new Error("unauthorized");
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.anonymizedAt) throw new Error("unauthorized");
    // A suspended account gets no socket either. The HTTP guard would already
    // have refused every request this connection's board depends on, but a live
    // socket is the one way into this app that never passes through it — and
    // "banned but still typing in the chat" is the version of this bug someone
    // would actually notice.
    if (banIsActive(user)) throw new Error("unauthorized");

    // No membership check here any more: there is no one trip to check against.
    // A socket proves *who you are*; what you may do on a given board is asked
    // when you try to do it, against that board. `syncRooms` is what decides
    // which rooms this connection can hear, and it reads the membership table.
    (client.data as SocketData) = { userId: user.id };
  }

  /**
   * The caller's live role on a trip, or null if they are not on it.
   *
   * Read per action rather than pinned at the handshake. On a per-trip socket
   * the snapshot was defensible — the connection lasted about as long as a page
   * visit, so a demotion corrected itself the next time you navigated. A
   * session-long connection has no such moment: an organizer demoted to Guest
   * would have gone on deleting other people's messages until they closed the
   * tab. One indexed lookup per action is what the REST guards already spend.
   */
  private async roleOn(
    userId: string,
    tripId: string,
  ): Promise<TripRole | null> {
    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId } },
      select: { role: true },
    });
    if (!membership) return null;
    // A block ejects the membership row, so this is belt-and-braces — and it is
    // what keeps the socket honest to FR-17 independently of that row.
    const block = await this.prisma.tripBlock.findUnique({
      where: { tripId_userId: { tripId, userId } },
      select: { tripId: true },
    });
    return block ? null : membership.role;
  }

  /**
   * Post a message (Phase 4.2). The stored message is broadcast to everyone else
   * in the chat room; the **sender** receives it back through this ack and
   * reconciles it against its optimistic copy (so the sender never sees a
   * duplicate).
   *
   * The capability is checked here rather than left to the handshake. The
   * handshake proves *membership*, which was enough while every member could
   * post; a Guest is a member who cannot, and a socket event has no route guard
   * standing in front of it.
   */
  @SubscribeMessage(MESSAGE_SEND_EVENT)
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<MessageAck> {
    const data = client.data as SocketData;
    const parsed = SendMessageInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid message" };
    // Which board is this channel on, and what is the caller there *now*. Both
    // used to be pinned at the handshake; on a socket that spans every board
    // and outlives a role change, neither can be.
    const tripId = await this.messages.tripOfChannel(parsed.data.channelId);
    const role = tripId ? await this.roleOn(data.userId, tripId) : null;
    if (!tripId || !role || !can(role, "message.post")) {
      return { ok: false, error: "You can't post in this board's chat." };
    }
    // Keyed on the user, not the socket, so extra tabs don't multiply the
    // budget. Refusal is an ordinary ack: the client already renders a failed
    // send, and dropping the connection would cost them the rest of the chat.
    const quota = this.rateLimiter.consume(
      `msg:${data.userId}`,
      MESSAGE_BURST,
      MESSAGE_WINDOW_MS,
    );
    if (!quota.allowed) {
      return {
        ok: false,
        error: `You're sending messages too fast — try again in ${Math.ceil(
          quota.retryAfterMs / 1000,
        )}s.`,
      };
    }
    try {
      const message = await this.messages.post(
        tripId,
        data.userId,
        parsed.data,
      );
      client.to(chatRoom(tripId)).emit(MESSAGE_NEW_EVENT, message);
      return { ok: true, message };
    } catch (err) {
      return { ok: false, error: ackError(err) };
    }
  }

  /**
   * Soft-delete a message (Phase 4.2). The author may delete their own, an
   * Organizer anyone's (enforced in the service). The tombstone goes to the
   * **whole** room — including the actor's other tabs — since delete is not
   * optimistic.
   */
  @SubscribeMessage(MESSAGE_DELETE_EVENT)
  async onDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<MessageAck> {
    const data = client.data as SocketData;
    const parsed = DeleteMessageInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid request" };
    const tripId = await this.messages.tripOfMessage(parsed.data.messageId);
    const role = tripId ? await this.roleOn(data.userId, tripId) : null;
    // The role decides whether this may delete *somebody else's* message, so a
    // stale one is the difference between moderating a board and vandalising
    // it. Read here, against this board, at the moment of the attempt.
    if (!tripId || !role) {
      return { ok: false, error: "You can't post in this board's chat." };
    }
    try {
      const message = await this.messages.softDelete(
        tripId,
        data.userId,
        role,
        parsed.data.messageId,
      );
      this.server.to(chatRoom(tripId)).emit(MESSAGE_DELETED_EVENT, message);
      return { ok: true, message };
    } catch (err) {
      return { ok: false, error: ackError(err) };
    }
  }

  /** Add the caller's reaction (Phase 4.3, any member). Idempotent; the refreshed
   * public reaction groups broadcast to the whole room (the actor reconciles its
   * optimistic toggle against the authoritative set). */
  @SubscribeMessage(REACTION_ADD_EVENT)
  onReactionAdd(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<ReactionAck> {
    return this.mutateReaction(client, raw, (tripId, userId, input) =>
      this.messages.addReaction(tripId, userId, input.messageId, input.emoji),
    );
  }

  /** Remove the caller's reaction (Phase 4.3). Idempotent; broadcasts the update. */
  @SubscribeMessage(REACTION_REMOVE_EVENT)
  onReactionRemove(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<ReactionAck> {
    return this.mutateReaction(client, raw, (tripId, userId, input) =>
      this.messages.removeReaction(
        tripId,
        userId,
        input.messageId,
        input.emoji,
      ),
    );
  }

  private async mutateReaction(
    client: Socket,
    raw: unknown,
    run: (
      tripId: string,
      userId: string,
      input: { messageId: string; emoji: string },
    ) => Promise<ReactionUpdate>,
  ): Promise<ReactionAck> {
    const data = client.data as SocketData;
    const parsed = ReactionInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid reaction" };
    const tripId = await this.messages.tripOfMessage(parsed.data.messageId);
    const role = tripId ? await this.roleOn(data.userId, tripId) : null;
    // Reacting is posting, by the same row of the matrix — see `onSend`.
    if (!tripId || !role || !can(role, "message.post")) {
      return { ok: false, error: "You can't post in this board's chat." };
    }
    try {
      const update = await run(tripId, data.userId, parsed.data);
      this.server.to(chatRoom(tripId)).emit(REACTION_UPDATED_EVENT, update);
      return { ok: true, update };
    } catch (err) {
      return { ok: false, error: ackError(err) };
    }
  }
}
