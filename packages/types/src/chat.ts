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

/** A channel's unread count for the connecting member (Phase 4.4): messages
 * after their read cursor authored by someone else. */
export const ChannelUnread = z.object({
  channelId: z.string().uuid(),
  count: z.number().int().nonnegative(),
});
export type ChannelUnread = z.infer<typeof ChannelUnread>;

/**
 * The payload of {@link SOCKET_READY_EVENT} (Phase 4.1, extended in 4.4). Sent
 * once a socket has authenticated and joined its trip room — and again on every
 * reconnect, so the unread counts are always fresh. Carries the channels the
 * member can see plus their per-channel unread counts.
 */
export const ChatReadyPayload = z.object({
  channels: z.array(ChannelView),
  unread: z.array(ChannelUnread),
});
export type ChatReadyPayload = z.infer<typeof ChatReadyPayload>;

/**
 * Server → client event emitted once a socket has authenticated and joined its
 * trip room (Phase 4.1). Payload is a {@link ChatReadyPayload}. Authentication
 * failures surface through Socket.IO's built-in `connect_error` instead.
 */
export const SOCKET_READY_EVENT = "chat:ready";

/** Client → server: start a discussion on a category, materializing its
 * {@link ChannelType} `CATEGORY` channel on demand (Phase 4.5, FR-29). General
 * is auto-created with the trip; category channels are created only when a member
 * asks for one. Idempotent — asking again returns the existing channel. */
export const StartDiscussionInput = z.object({
  categoryId: z.string().uuid(),
});
export type StartDiscussionInput = z.infer<typeof StartDiscussionInput>;

/**
 * Server → room broadcast when a channel is created (Phase 4.5). Emitted to
 * every trip viewer when a member starts a category discussion, so the channel
 * appears in their switcher live (without a reconnect). Payload is the new
 * {@link ChannelView}.
 */
export const CHANNEL_CREATED_EVENT = "channel:created";

/**
 * Server → room broadcast when a category's options change (Phase 4.5) — a
 * propose/edit/delete, a lock/unlock decision, a vote, or a reorder. Carries just
 * the ids; clients refetch the affected lane (and the cost dashboard), so a
 * locked decision and newly-proposed cards appear for every trip viewer without a
 * manual refresh. The payload is small on purpose — the socket signals *that*
 * something changed; the authoritative state is re-read over REST (FR-29,
 * "tolerate refresh").
 */
export const OPTIONS_CHANGED_EVENT = "options:changed";

/**
 * How far the change reached, so a listener refetches what actually moved
 * rather than everything on the screen.
 *
 * The event started as one undifferentiated "something about this lane changed",
 * which meant every vote cost each viewer four requests — the lane, the cost
 * dashboard, the category list and the trip detail — when a vote cannot touch
 * the last two. The kinds name the three genuinely different blast radii:
 *
 * - `option` — one option changed and nothing else can have: propose, edit,
 *   delete, vote, participation, reorder. The lane and the cost dashboard.
 * - `decision` — a lock or unlock. Deliberately the widest, because it really
 *   is: locking in a single-choice lane **unlocks the sibling it supersedes**,
 *   and locking a Dates option writes the trip's own `startDate`/`endDate` and
 *   expiry. Both the category list and the trip detail move with it.
 * - `category` — the lane itself was renamed or repainted. Its options are
 *   untouched, but the cost dashboard carries `categoryName` and the lane's
 *   palette, so a repaint that skipped it would leave the donut the old colour.
 */
export const OptionsChangedKind = z.enum(["option", "decision", "category"]);
export type OptionsChangedKind = z.infer<typeof OptionsChangedKind>;

/**
 * The payload of {@link OPTIONS_CHANGED_EVENT}: which lane changed, and how far
 * the change reached.
 *
 * `kind` is **optional on purpose**. Deploys roll, so for a minute a new client
 * can hold a socket to an old server that never sends it; a listener that reads
 * a missing `kind` as "narrow" would silently stop refreshing decisions in
 * exactly that window. Absent therefore means the widest radius — the old
 * behaviour, which was always correct, only wasteful.
 */
export const OptionsChanged = z.object({
  tripId: z.string().uuid(),
  categoryId: z.string().uuid(),
  kind: OptionsChangedKind.optional(),
});
export type OptionsChanged = z.infer<typeof OptionsChanged>;

/**
 * A public reaction group on a message (Phase 4.3): one emoji and the members
 * who reacted with it. Reactions are **public** (like votes): the client derives
 * the count from `userIds.length` and its own "viewer reacted" state from whether
 * its user id is in the list — so the shape is viewer-agnostic and identical
 * across history, the send ack, and live `reaction:updated` broadcasts.
 */
export const ReactionGroup = z.object({
  emoji: z.string(),
  userIds: z.array(z.string().uuid()),
});
export type ReactionGroup = z.infer<typeof ReactionGroup>;

/** A member resolved from an `@mention` in a message (Phase 4.3). Persisted for
 * Phase-5 notification delivery; surfaced here so the client can highlight it. */
export const MentionView = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
});
export type MentionView = z.infer<typeof MentionView>;

/**
 * A chat message as seen by the client (Phase 4.2, extended in 4.3). A
 * soft-deleted message keeps its row as a **tombstone**: `deleted` is true and
 * `body` is null, so history and live views render "message deleted" without
 * leaking the content. `reactions` and `mentions` carry the public reaction
 * groups and the resolved @mention targets.
 *
 * **The tombstone says who cleared it.** An organizer may delete anyone's
 * message, so "message deleted" left the room with the one question a removal
 * always raises — did they take it back, or did somebody take it from them? —
 * and no way to tell the two apart. `deletedById` answers it by comparison
 * against `authorId` rather than by a flag, so the reading stays true if the
 * roles change afterwards; `deletedByName` is the name to print, and is null
 * only for a tombstone written before this was recorded (or by an account since
 * anonymized, whose deletion nulls the reference).
 */
export const MessageView = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  /** Author's profile picture, or null for initials (Phase 6.2). */
  authorAvatarUrl: z.string().nullable(),
  /** Null once deleted — the tombstone carries no content. */
  body: z.string().nullable(),
  deleted: z.boolean(),
  /** Who deleted it; null on a live message and on an unattributed tombstone. */
  deletedById: z.string().uuid().nullable(),
  deletedByName: z.string().nullable(),
  createdAt: z.string(),
  reactions: z.array(ReactionGroup),
  mentions: z.array(MentionView),
});
export type MessageView = z.infer<typeof MessageView>;

/**
 * Resolve the `@mentions` in a message body to trip members (Phase 4.3). Pure
 * and server-authoritative: it matches `@<displayName>` case-insensitively for
 * each member, requiring the match to end on a non-word boundary so `@Ann` does
 * not match inside `@Anna`. Longer names are tried first so `@Ada Lovelace` wins
 * over a member also called `Ada`. Returns the matched member ids, de-duplicated.
 * Only real members can be mentioned — anything else in the text is ignored.
 */
export function resolveMentions(
  body: string,
  members: readonly { userId: string; displayName: string }[],
): string[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byLength = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  const matched = new Set<string>();
  // Work on a mutable copy: once a name matches, blank out its span so a shorter
  // name that is a prefix of it (e.g. "Ada" inside "@Ada Lovelace") can't also
  // match. Longest names are tried first for the same reason.
  let working = body;
  for (const m of byLength) {
    const re = new RegExp(`@${escape(m.displayName)}(?![\\w])`, "gi");
    const replaced = working.replace(re, (s) => " ".repeat(s.length));
    if (replaced !== working) {
      matched.add(m.userId);
      working = replaced;
    }
  }
  return [...matched];
}

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

/** Client → server: add/remove the caller's reaction on a message (Phase 4.3,
 * any member). Both are idempotent; the ack carries the message's refreshed
 * reaction groups, which also broadcast to the room. */
export const ReactionInput = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().min(1).max(16),
});
export type ReactionInput = z.infer<typeof ReactionInput>;

/** The payload broadcast to the room (and returned via ack) when a message's
 * reactions change (Phase 4.3). */
export const ReactionUpdate = z.object({
  messageId: z.string().uuid(),
  reactions: z.array(ReactionGroup),
});
export type ReactionUpdate = z.infer<typeof ReactionUpdate>;

/** The ack for a `reaction:add`/`reaction:remove` emit. */
export type ReactionAck =
  | { ok: true; update: ReactionUpdate }
  | { ok: false; error: string };

/** Socket event names for reactions (Phase 4.3). Add/remove are client→server
 * emits (with ack); updated is the server→room broadcast. */
export const REACTION_ADD_EVENT = "reaction:add";
export const REACTION_REMOVE_EVENT = "reaction:remove";
export const REACTION_UPDATED_EVENT = "reaction:updated";

/** The fixed emoji palette offered in the reaction picker (Phase 4.3). */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const;
