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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the gateway pins on an authenticated socket after the handshake. The
 * role is snapshotted here for the message-delete rule; it is refreshed on each
 * reconnect (the handshake re-runs), consistent with the per-request model. */
interface SocketData {
  userId: string;
  tripId: string;
  role: TripRole;
}

/** Turn a thrown service error into the ack error string sent to the client. */
function ackError(err: unknown): string {
  return err instanceof HttpException ? err.message : "Something went wrong";
}

/**
 * The per-trip real-time gateway (Phase 4.1). One Socket.IO connection per open
 * trip. Authentication + authorization run in a connection **middleware** so an
 * unauthorized socket is rejected *during* the handshake (the client sees
 * `connect_error`), never connected-then-dropped. The discipline mirrors the
 * REST guards exactly: verify the access token, load the user fresh from the DB,
 * then confirm trip membership and the absence of a block — the role/block is a
 * DB check, never trusted from the handshake payload (SRS FR-4). Only then does
 * the socket join its single trip room. Messages/reactions land in 4.2–4.3.
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
    // The middleware only calls next() after pinning both; this is defensive.
    if (!data.userId || !data.tripId) {
      client.disconnect(true);
      return;
    }
    // Three rooms, and the third is conditional. The trip's carries the board's
    // own live events, the user's carries notifications about *any* trip they
    // belong to (Phase 5.1), and the chat room carries the transcript — which a
    // Guest does not get. See `realtime/chat-room`.
    await client.join(tripRoom(data.tripId));
    await client.join(userRoom(data.userId));
    const reads = can(data.role!, "message.read");
    if (reads) await client.join(chatRoom(data.tripId));
    // An empty payload for a role with no chat: the ready event tells the board
    // which channels exist and how much is unread in each, and both are answers
    // to a question this reader is not allowed to ask.
    //
    // Annotated, and the annotation is load-bearing. Written as a bare object
    // literal the empty branch typechecked with the *wrong field name* in it —
    // `client.emit` takes `any`, so nothing downstream ever compared it to the
    // contract. The type is what makes the two branches agree.
    const payload: ChatReadyPayload = reads
      ? await this.channels.readyPayload(data.tripId, data.userId)
      : { channels: [], unread: [] };
    client.emit(SOCKET_READY_EVENT, payload);
    this.logger.debug(`socket joined ${tripRoom(data.tripId)}`);
  }

  /**
   * Handshake gate. Throws on any failure so the connection middleware rejects
   * the socket; on success pins `{ userId, tripId }` for the room join above.
   */
  private async authenticate(client: Socket): Promise<void> {
    const auth = client.handshake.auth as { token?: unknown; tripId?: unknown };
    const token = typeof auth.token === "string" ? auth.token : "";
    const tripId = typeof auth.tripId === "string" ? auth.tripId : "";
    if (!token || !UUID_RE.test(tripId)) throw new Error("unauthorized");

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

    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
    });
    // Non-members are refused: a socket never joins a trip it isn't part of.
    if (!membership) throw new Error("forbidden");

    // A block ejects membership already, so this is belt-and-suspenders — but it
    // keeps the socket gate honest to FR-17 independent of the membership row.
    const block = await this.prisma.tripBlock.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
    });
    if (block) throw new Error("forbidden");

    (client.data as SocketData) = {
      userId: user.id,
      tripId,
      role: membership.role,
    };
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
    if (!can(data.role, "message.post")) {
      return { ok: false, error: "You can't post in this board's chat." };
    }
    const parsed = SendMessageInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid message" };
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
        data.tripId,
        data.userId,
        parsed.data,
      );
      client.to(chatRoom(data.tripId)).emit(MESSAGE_NEW_EVENT, message);
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
    try {
      const message = await this.messages.softDelete(
        data.tripId,
        data.userId,
        data.role,
        parsed.data.messageId,
      );
      this.server
        .to(chatRoom(data.tripId))
        .emit(MESSAGE_DELETED_EVENT, message);
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
    return this.mutateReaction(client, raw, (data, input) =>
      this.messages.addReaction(
        data.tripId,
        data.userId,
        input.messageId,
        input.emoji,
      ),
    );
  }

  /** Remove the caller's reaction (Phase 4.3). Idempotent; broadcasts the update. */
  @SubscribeMessage(REACTION_REMOVE_EVENT)
  onReactionRemove(
    @ConnectedSocket() client: Socket,
    @MessageBody() raw: unknown,
  ): Promise<ReactionAck> {
    return this.mutateReaction(client, raw, (data, input) =>
      this.messages.removeReaction(
        data.tripId,
        data.userId,
        input.messageId,
        input.emoji,
      ),
    );
  }

  private async mutateReaction(
    client: Socket,
    raw: unknown,
    run: (
      data: SocketData,
      input: { messageId: string; emoji: string },
    ) => Promise<ReactionUpdate>,
  ): Promise<ReactionAck> {
    const data = client.data as SocketData;
    // Reacting is posting, by the same row of the matrix — see `onSend`.
    if (!can(data.role, "message.post")) {
      return { ok: false, error: "You can't post in this board's chat." };
    }
    const parsed = ReactionInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid reaction" };
    try {
      const update = await run(data, parsed.data);
      this.server
        .to(chatRoom(data.tripId))
        .emit(REACTION_UPDATED_EVENT, update);
      return { ok: true, update };
    } catch (err) {
      return { ok: false, error: ackError(err) };
    }
  }
}
