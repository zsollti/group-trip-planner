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

/**
 * A channel as seen by the client. A GENERAL channel has a null `categoryId`.
 *
 * `lastMessageAt` is when the channel last had something said in it (deleted
 * messages excluded), or null for one nobody has written in yet. It exists so
 * the switcher can lead with the conversations that are actually moving: a trip
 * with eight category discussions had them in creation order, which is the one
 * order that has nothing to do with where the talking is. Ordering is the
 * client's to apply — the server states the fact and stays order-agnostic.
 */
export const ChannelView = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  type: ChannelType,
  lastMessageAt: z.string().nullable(),
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
}

/**
 * Client to server: re-run the room join for this connection (post-launch).
 *
 * One socket now covers every board the reader is on, which means its rooms are
 * decided once at connect and can go stale — you join a trip, you are removed
 * from one — where a per-trip socket re-handshook every time you navigated. The
 * client emits this when its own trip list changes; the server re-reads the
 * membership table, so it grants nothing.
 */
export const ROOMS_REFRESH_EVENT = "rooms:refresh";

/** A channel's unread count for the connecting member (Phase 4.4): messages
 * after their read cursor authored by someone else. */
export const ChannelUnread = z.object({
  channelId: z.string().uuid(),
  count: z.number().int().nonnegative(),
});
export type ChannelUnread = z.infer<typeof ChannelUnread>;

/**
 * Silencing a board's chat for one reader (post-launch).
 *
 * **Not the same switch as the trip's email mute.** `TripMembership.muted`
 * stops this trip's notification email; this stops the app's own chat — the
 * unread badges and the mention toasts — for the member who asked. A person
 * who wants their inbox quiet and their badges live, or the reverse, is asking
 * for something ordinary, so the two are separate columns and separate
 * controls: "Mute email" in the trip menu, "Mute chat" in the chat's own.
 *
 * **It silences; it does not stop counting.** A muted board goes on accruing
 * unread server-side, and lifting the mute shows what was missed rather than
 * starting from zero. Muting is a statement about what the reader wants shown
 * now, not an instruction to throw away what arrives meanwhile.
 */
export const ChatMuteDuration = z.enum(["HOUR", "DAY", "ALWAYS"]);
export type ChatMuteDuration = z.infer<typeof ChatMuteDuration>;

/**
 * How long each timed duration lasts, in minutes.
 *
 * Here rather than on the server so the menu and the route cannot disagree
 * about what "1 hour" means. `ALWAYS` is absent on purpose: it has no length,
 * which is the whole of the difference between it and the other two, and giving
 * it a number here would invite somebody to add it up.
 */
export const CHAT_MUTE_MINUTES: Readonly<Record<"HOUR" | "DAY", number>> = {
  HOUR: 60,
  DAY: 60 * 24,
};

/** Set or lift the chat mute. A null `duration` lifts it. */
export const ChatMuteInput = z.object({
  duration: ChatMuteDuration.nullable(),
});
export type ChatMuteInput = z.infer<typeof ChatMuteInput>;

/**
 * The mute as it stands for this reader on this board.
 *
 * `mutedUntil` is sent as well as `muted` so the client can let a timed mute
 * lapse on its own. A socket that stays connected for three hours would
 * otherwise go on hiding badges for an hour-long mute until something made it
 * reconnect, and the reader would have no way to tell the difference between
 * "still muted" and "the app forgot".
 */
export const ChatMuteView = z.object({
  muted: z.boolean(),
  /** When it lapses by itself; null means it stands until it is lifted. */
  mutedUntil: z.string().nullable(),
});
export type ChatMuteView = z.infer<typeof ChatMuteView>;

/** One board this reader has muted, as carried in the socket's ready payload. */
export const TripChatMute = ChatMuteView.extend({
  tripId: z.string().uuid(),
});
export type TripChatMute = z.infer<typeof TripChatMute>;

/**
 * The payload of {@link SOCKET_READY_EVENT} (Phase 4.1, extended in 4.4). Sent
 * once a socket has authenticated and joined its trip room — and again on every
 * reconnect, so the unread counts are always fresh. Carries the channels the
 * member can see plus their per-channel unread counts.
 */
export const ChatReadyPayload = z.object({
  channels: z.array(ChannelView),
  unread: z.array(ChannelUnread),
  /**
   * The boards this reader has muted (post-launch). Only the muted ones are
   * listed — an absent trip is an unmuted trip, which keeps the payload the
   * size of the exception rather than the size of the membership list.
   *
   * It rides the ready payload rather than a query per board because the badges
   * are drawn from this same payload: fetching the mutes separately would mean
   * a frame where every board's unread is shown before the app remembers which
   * of them were meant to be quiet.
   */
  mutes: z.array(TripChatMute),
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
 * Server → room broadcast when discussions are deleted (post-launch).
 *
 * Carries the ids, not the channels: what a client has to do with this is
 * forget them, and it already knows everything it is about to drop. Sent to the
 * whole trip room because a deleted discussion has to vanish from every
 * switcher, not just the organizer's who deleted it — the alternative is a chip
 * that 404s for everyone else until they reload.
 */
export const CHANNELS_DELETED_EVENT = "channels:deleted";

/**
 * Delete a board's discussions (post-launch, organizers).
 *
 * A list rather than one id per request, because the control is a list with
 * checkboxes and one Delete: sending five requests for five ticks would leave
 * a half-done deletion possible in a way one request does not.
 *
 * **The trip-wide channel is not in this list, ever.** It is created inside the
 * trip-creation transaction and nothing recreates it, so deleting it would take
 * a board's only permanent conversation away with no way back. Lane discussions
 * are different in exactly the way that matters: `POST /trips/:id/channels`
 * restarts one on demand, so deleting a discussion is closing it, not razing it.
 */
export const DeleteChannelsInput = z.object({
  channelIds: z.array(z.string().uuid()).min(1).max(50),
});
export type DeleteChannelsInput = z.infer<typeof DeleteChannelsInput>;

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
    const replaced = working.replace(re, (s) => "".repeat(s.length));
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

/**
 * Searching a board's transcript (`GET /trips/:id/messages/search?q=`).
 *
 * **The whole board, not the channel you are standing in.** A trip's talking is
 * spread across its lane discussions by design, so "did anyone ever mention the
 * airport transfer" is a question about the board — and the one channel the
 * reader happens to have open is the least useful place to answer it. Every
 * `MessageView` already names its `channelId`, so a hit says where it was said
 * without a wrapper type.
 *
 * **Substring, not words.** People search chat for fragments: half a hotel
 * name, a price, a flight number. Postgres full-text would tokenize those away.
 *
 * Deleted messages never match: a tombstone has no body to search, and
 * surfacing one would be a way to read around a deletion.
 */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;
export const MESSAGE_SEARCH_MAX_LENGTH = 200;

/**
 * Most hits one search returns.
 *
 * A cap rather than a page, because this is a *find*, not a second transcript:
 * a search worth more than fifty hits is a search that needs different words,
 * and `truncated` says so plainly instead of offering to paginate through the
 * board's whole history.
 */
export const MESSAGE_SEARCH_LIMIT = 50;

/** The hits, newest first, and whether the cap cut the list short. */
export const MessageSearchView = z.object({
  messages: z.array(MessageView),
  truncated: z.boolean(),
});
export type MessageSearchView = z.infer<typeof MessageSearchView>;

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
  { ok: true; message: MessageView } | { ok: false; error: string };

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
  { ok: true; update: ReactionUpdate } | { ok: false; error: string };

/** Socket event names for reactions (Phase 4.3). Add/remove are client→server
 * emits (with ack); updated is the server→room broadcast. */
export const REACTION_ADD_EVENT = "reaction:add";
export const REACTION_REMOVE_EVENT = "reaction:remove";
export const REACTION_UPDATED_EVENT = "reaction:updated";

/** The fixed emoji palette offered in the reaction picker (Phase 4.3). */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const;
