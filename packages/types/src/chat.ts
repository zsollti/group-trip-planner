import { z } from "zod";

/**
 * Chat contract (Phase 4.1, SRS §6 / FR-29–32). The shared shapes for the
 * real-time layer. 4.1 lands the channel model and the authenticated socket
 * handshake; messages, reactions, and mentions arrive in 4.2–4.3.
 */

/**
 * A trip's chat channel kind. `GENERAL` is auto-created with the trip; `CATEGORY`
 * channels are created on demand per category (Phase 4.5, FR-29).
 */
export const ChannelType = z.enum(["GENERAL", "CATEGORY"]);
export type ChannelType = z.infer<typeof ChannelType>;

/** A channel as seen by the client. A GENERAL channel has a null `categoryId`. */
export const ChannelView = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  type: ChannelType,
});
export type ChannelView = z.infer<typeof ChannelView>;

/**
 * The handshake payload the client sends when opening a trip socket (Phase 4.1).
 * The access `token` authenticates the connection; `tripId` scopes it to one
 * trip room. **Authorization is re-checked against the DB server-side** (fresh
 * membership + block lookup) and is never trusted from this payload — the same
 * per-request DB-check discipline the REST guards use (SRS FR-4).
 */
export interface TripSocketAuth {
  token: string;
  tripId: string;
}

/**
 * Server → client event emitted once a socket has authenticated and joined its
 * trip room (Phase 4.1). Its payload is the {@link ChannelView} list the member
 * can see (General now; category channels in 4.5). Authentication failures
 * surface through Socket.IO's built-in `connect_error` instead.
 */
export const SOCKET_READY_EVENT = "chat:ready";

/**
 * A chat message as seen by the client (Phase 4.2). A soft-deleted message keeps
 * its row as a **tombstone**: `deleted` is true and `body` is null, so history
 * and live views render "message deleted" without ever leaking the content.
 */
export const MessageView = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  /** Null once deleted — the tombstone carries no content. */
  body: z.string().nullable(),
  deleted: z.boolean(),
  createdAt: z.string(),
});
export type MessageView = z.infer<typeof MessageView>;

/** A cursor-paged slice of channel history, newest-first (Phase 4.2). The
 * `nextCursor` (an opaque message id) fetches the next older page, or is null
 * when the channel start is reached. */
export const MessagePage = z.object({
  messages: z.array(MessageView),
  nextCursor: z.string().nullable(),
});
export type MessagePage = z.infer<typeof MessagePage>;

/** Longest a chat message may be (characters). */
export const MESSAGE_MAX_LENGTH = 4000;

/** Client → server: post a message to a channel (Phase 4.2). Emitted over the
 * socket with an ack callback; the server persists and replies with the stored
 * {@link MessageView}, which the client reconciles against its optimistic copy. */
export const SendMessageInput = z.object({
  channelId: z.string().uuid(),
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

/** Client → server: soft-delete a message (author's own, or an Organizer's any). */
export const DeleteMessageInput = z.object({
  messageId: z.string().uuid(),
});
export type DeleteMessageInput = z.infer<typeof DeleteMessageInput>;

/** The ack payload the server returns to a `message:send`/`message:delete`
 * emit: the stored message on success, or an error string the client surfaces
 * (and, for a send, rolls the optimistic message back). */
export type MessageAck =
  | { ok: true; message: MessageView }
  | { ok: false; error: string };

/** Socket event names for the message stream (Phase 4.2). Send/delete are
 * client→server emits (with ack); new/deleted are server→room broadcasts. */
export const MESSAGE_SEND_EVENT = "message:send";
export const MESSAGE_DELETE_EVENT = "message:delete";
export const MESSAGE_NEW_EVENT = "message:new";
export const MESSAGE_DELETED_EVENT = "message:deleted";
