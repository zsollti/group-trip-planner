import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { intlTag } from "../lib/locale";
import {
  useChat,
  useTripMembers,
  type ChatMessage,
  type SessionSocket,
} from "@gtp/api-client";
import {
  canDeleteMessage,
  REACTION_EMOJIS,
  type CategoryView,
  type ChannelView,
  type MentionView,
  type TripRole,
} from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { Avatar } from "./Avatar";
import { Menu } from "./Menu";
import { partitionByFit, useFitCount } from "../lib/fitTabs";
import { applyOrder, orderChannels } from "../lib/channelOrder";
import { truncateName } from "../lib/truncate";
import { t } from "../lib/i18n";

/**
 * Last-resort sizes for the switcher row: what the "＋N" trigger claims and the
 * flex gap between chips. Both are **measured** in the browser now
 * ({@link useFitCount}) — these stand in only where there is nothing to measure,
 * which means before a trigger exists and in jsdom.
 *
 * They used to be the real answer, and being generous with them cost a chip: the
 * reserve was sized for the widest the trigger ever gets and then charged on
 * every row, so a chip with obvious room beside it stayed collapsed.
 */
const OVERFLOW_RESERVE_FALLBACK_PX = 40;
const TAB_GAP_FALLBACK_PX = 5;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(intlTag(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Render a message body with its resolved @mentions highlighted. */
function renderBody(body: string, mentions: MentionView[]) {
  if (mentions.length === 0) return body;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Longest names first so "@Ada Lovelace" wins over "@Ada".
  const names = [...mentions]
    .map((m) => m.displayName)
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const re = new RegExp(`@(?:${names.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(re)) {
    const start = match.index;
    if (start > last) out.push(body.slice(last, start));
    out.push(
      <span key={start} className="board__mention">
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/**
 * What is left where a deleted message was.
 *
 * Three sentences, not one, because "message deleted" answered the question
 * nobody asks and left the one everybody does: an organizer may delete anyone's
 * message, so a line that vanishes without a name reads as censorship or as a
 * bug, depending on the reader's mood. Saying who removed it makes the
 * moderation visible, which is the only thing that makes it accountable.
 *
 * **Who, not what rank.** The server sends the deleter's id and the row is
 * compared against the author's, so a person taking back their own words is a
 * different sentence from someone else taking them — and it stays the right
 * sentence after roles change, which a stored "was moderated" flag would not.
 *
 * Whole sentences in the catalogue with the names as placeholders: a translator
 * needs to be able to move the two names past the verb, and Hungarian does
 * exactly that ("X törölte Y üzenetét").
 *
 * The unattributed fallback is not dead code — a tombstone written before this
 * shipped has no deleter recorded, and the FK nulls itself when that account is
 * deleted, so both are ordinary states rather than corruption.
 */
function tombstone(message: ChatMessage): string {
  if (!message.deletedByName) return t("message deleted");
  if (message.deletedById === message.authorId) {
    return t("{name} deleted their message", { name: message.deletedByName });
  }
  return t("{actor} deleted {author}'s message", {
    actor: message.deletedByName,
    author: message.authorName,
  });
}

/** One message row: tombstone, optimistic-pending/failed, or a normal message
 * with reaction chips, a reaction picker, and a delete affordance. */
function MessageRow({
  message,
  myRole,
  myUserId,
  onDelete,
  onToggleReaction,
}: {
  message: ChatMessage;
  myRole: TripRole;
  myUserId: string | undefined;
  onDelete: (id: string) => void;
  onToggleReaction: (id: string, emoji: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  if (message.deleted) {
    return (
      <li className="board__msg board__msg--tombstone">
        <span className="board__msg-body">{tombstone(message)}</span>
      </li>
    );
  }
  const isAuthor = message.authorId === myUserId;
  const canDelete =
    !message.pending && !message.failed && canDeleteMessage(myRole, isAuthor);
  const live = !message.pending && !message.failed;

  return (
    <li
      className={
        "board__msg" +
        (message.pending ? " board__msg--pending" : "") +
        (message.failed ? " board__msg--failed" : "")
      }
    >
      <div className="board__msg-head">
        <Avatar
          name={message.authorName}
          userId={message.authorId}
          url={message.authorAvatarUrl}
          size={22}
        />
        <span className="board__msg-author">{message.authorName}</span>
        <span className="board__msg-time">
          {message.failed ? t("not sent") : timeLabel(message.createdAt)}
        </span>
        {canDelete ? (
          <button
            type="button"
            className="board__msg-del"
            aria-label={t("Delete message")}
            onClick={() => onDelete(message.id)}
          >
            ×
          </button>
        ) : null}
      </div>
      <p className="board__msg-body">
        {message.body ? renderBody(message.body, message.mentions) : null}
      </p>

      {live ? (
        <div className="board__reactions">
          {message.reactions.map((g) => (
            <button
              key={g.emoji}
              type="button"
              className={
                "board__reaction" +
                (myUserId && g.userIds.includes(myUserId)
                  ? " board__reaction--on"
                  : "")
              }
              aria-pressed={myUserId ? g.userIds.includes(myUserId) : false}
              aria-label={t("{emoji} {n}", {
                emoji: g.emoji,
                n: g.userIds.length,
              })}
              onClick={() => onToggleReaction(message.id, g.emoji)}
            >
              {g.emoji} {g.userIds.length}
            </button>
          ))}
          <div className="board__reaction-add">
            <button
              type="button"
              className="board__reaction-addbtn"
              aria-label={t("Add reaction")}
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              ＋
            </button>
            {picking ? (
              <div className="board__reaction-picker" role="menu">
                {REACTION_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="menuitem"
                    aria-label={t("React {emoji}", { emoji: e })}
                    onClick={() => {
                      onToggleReaction(message.id, e);
                      setPicking(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Trip chat (Phase 4.2, +reactions/@mentions in 4.3, +channels in 4.5). A
 * collapsible docked panel over the shared trip socket: live send/receive with
 * optimistic sends, soft-delete tombstones, cursor "load older", public emoji
 * reactions, and @mention autocomplete + highlighting. Chat stays open in a
 * History trip (chat is exempt from the freeze, FR-10).
 *
 * Phase 4.5 adds **channels**: a switcher across the trip-wide channel and any
 * on-demand **category** discussions (FR-29). A category channel is reached
 * either from its switcher chip or by the board's per-lane "Discuss" action,
 * which flows a channel id in through `requestChannelId` (opening the panel and
 * selecting that channel). A deleted category's channel cascades away
 * server-side; it is hidden here as soon as its category is gone.
 *
 * The switcher keeps to **one row**: the chips that fit are shown and the rest
 * collapse behind a "＋N" menu ({@link useFitCount}). It used to scroll
 * horizontally, which hid the tail of the list on a panel this narrow.
 */
export function ChatPanel({
  tripId,
  tripName,
  sessionSocket,
  categories,
  myRole,
  myUserId,
  requestChannelId,
  onRequestHandled,
  onClose,
  onCollapse,
  onBack,
}: {
  tripId: string;
  /** Labels the trip-wide channel — it is this trip's conversation, so the chip
   *  reads the board's name rather than a generic "General". */
  tripName: string;
  /**
   * The session's socket, carrying every board's channels.
   *
   * The panel takes the whole thing and narrows it, rather than being handed a
   * pre-filtered list, because the filter and the `tripId` it uses have to
   * agree — and this component is the only place that knows which board it is
   * drawing.
   */
  sessionSocket: SessionSocket;
  categories: CategoryView[];
  myRole: TripRole;
  myUserId: string | undefined;
  /** A channel to open + select (from a lane's "Discuss" action); null when idle. */
  requestChannelId: string | null;
  onRequestHandled: () => void;
  /** Shut the whole dock. */
  onClose: () => void;
  /**
   * Fold this board's conversation down to a bubble beside the launcher.
   *
   * Distinct from {@link onClose}, and the distinction is the point: closing
   * ends the reading, collapsing parks it. A reader following two boards can
   * put one out of the way without losing the fact that they are following it,
   * and the bubble goes on counting what arrives.
   */
  onCollapse: () => void;
  /** Back to the list of conversations, where there is more than one board to
   *  choose between. Absent when there is nothing to go back to. */
  onBack?: () => void;
}) {
  const { socket, channels, unread, markChannelRead, setActiveChannel } =
    sessionSocket;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  /**
   * This board's channels, out of the session's.
   *
   * One socket now carries every conversation the reader is part of, so the
   * first thing the panel does is narrow that to the board it is showing.
   * Everything downstream — the switcher, the unread badges, the ordering —
   * counts what is in here, which is what keeps a busy trip elsewhere from
   * appearing in this trip's row.
   */
  const mine = useMemo(
    () => channels.filter((c) => c.tripId === tripId),
    [channels, tripId],
  );
  const general = mine.find((c) => c.type === "GENERAL");
  // Category channels for categories that still exist (a deleted category's
  // channel is gone server-side; hide it until the socket list catches up).
  const listed = useMemo<ChannelView[]>(() => {
    const cats = mine.filter(
      (c) =>
        c.type === "CATEGORY" && c.categoryId && categoryName.has(c.categoryId),
    );
    return general ? [general, ...cats] : cats;
  }, [mine, general, categoryName]);

  // The selected channel, falling back to General if the selection went away.
  const activeChannel = listed.find((c) => c.id === activeId) ?? general;
  const activeChannelId = activeChannel?.id;

  const chat = useChat(socket, tripId, activeChannelId, myUserId);
  // The panel only exists while it is open now, so there is no closed state to
  // avoid fetching in: mounting *is* opening.
  const members = useTripMembers(tripId);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const totalUnread = listed.reduce((sum, c) => sum + (unread[c.id] ?? 0), 0);

  /** The channel's full name — the trip's own name for the trip-wide channel. */
  function channelName(channel: ChannelView): string {
    if (channel.type === "GENERAL") return tripName;
    return channel.categoryId
      ? (categoryName.get(channel.categoryId) ?? t("Discussion"))
      : t("Discussion");
  }
  /** Shortened for a chip; `channelName` stays available for `title`. */
  function channelLabel(channel: ChannelView): string {
    return truncateName(channelName(channel));
  }

  // The order the row shows them in ({@link orderChannels}: the trip's own
  // channel, then whatever was last spoken in). Held as a snapshot of ids rather
  // than recomputed every render — it is refreshed when the panel opens and when
  // the channel set changes, and deliberately left alone in between. Re-sorting
  // live would move a chip out from under the cursor every time a message landed
  // somewhere else, which is a worse row than one a few seconds stale.
  const [order, setOrder] = useState<string[]>([]);
  const channelSetKey = useMemo(
    () =>
      listed
        .map((c) => c.id)
        .sort()
        .join(","),
    [listed],
  );
  useEffect(() => {
    setOrder(orderChannels(listed, general?.id).map((c) => c.id));
    // `listed` and `general` are read but not depended on, and that is the whole
    // point: `listed` gets a new identity on every incoming message (a message
    // moves its channel's `lastMessageAt`), so depending on it would re-sort
    // exactly when this must not.
    //
    // `tripId` is in the array because the panel is reused across boards: the
    // dock swaps which trip it shows without unmounting, and an order held from
    // the last board would put this one's channels in somebody else's sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, channelSetKey]);
  const ordered = useMemo(() => applyOrder(listed, order), [listed, order]);

  // One row of chips: those that fit, plus a "＋N" menu for the remainder. The
  // active channel is always among the visible ones — collapsing the channel you
  // are reading would leave the row showing everywhere you *aren't*.
  const fit = useFitCount(
    ordered.length,
    OVERFLOW_RESERVE_FALLBACK_PX,
    TAB_GAP_FALLBACK_PX,
  );
  const { shown: shownChannels, hidden: hiddenChannels } = useMemo(
    () =>
      partitionByFit(
        ordered,
        fit.visibleCount,
        (c) => c.id === activeChannelId,
      ),
    [ordered, fit.visibleCount, activeChannelId],
  );
  // Surfaced on the trigger: a collapsed channel's unread count must not vanish
  // with the chip.
  const hiddenUnread = hiddenChannels.reduce(
    (sum, c) => sum + (unread[c.id] ?? 0),
    0,
  );

  function selectChannel(id: string) {
    setActiveId(id);
    setActiveChannel(id);
  }

  /*
   * Land on a channel as soon as there is one to land on.
   *
   * The panel used to choose when it opened, because it owned the opening. The
   * dock owns that now — so this runs when the panel mounts, and again if the
   * channel list arrives after it (the socket's ready payload can land a beat
   * later than the render that shows this board).
   */
  useEffect(() => {
    if (activeChannelId) return;
    const target = general?.id ?? listed[0]?.id ?? null;
    if (!target) return;
    setActiveId(target);
    setActiveChannel(target);
  }, [activeChannelId, general, listed, setActiveChannel]);

  // A lane's "Discuss" action requested a channel: select it, once.
  useEffect(() => {
    if (!requestChannelId) return;
    setActiveId(requestChannelId);
    setActiveChannel(requestChannelId);
    onRequestHandled();
    // A one-shot request; the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestChannelId]);

  // Leaving the panel stops the active channel being active — otherwise the
  // board it was on would go on suppressing its own unread badge.
  useEffect(() => {
    return () => setActiveChannel(null);
  }, [setActiveChannel]);

  // Keep the newest message in view as the log grows, and keep the active channel
  // marked read while it's open so new arrivals don't re-badge it.
  const count = chat.messages.length;
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
    if (activeChannelId) markChannelRead(activeChannelId);
  }, [count, activeChannelId, markChannelRead]);

  // @mention autocomplete: the token being typed just before the caret.
  const [caret, setCaret] = useState(0);
  const mentionQuery = useMemo(() => {
    const before = draft.slice(0, caret);
    const m = /@([^@\n]*)$/.exec(before);
    return m ? (m[1] ?? "") : null;
  }, [draft, caret]);
  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return (members.data?.members ?? [])
      .filter(
        (mem) =>
          // Never yourself. A mention notifies everyone it names *except* its
          // author (`notificationRecipients`), so offering your own name here
          // was the list advertising the one choice on it that provably does
          // nothing — no badge, no email, no trace that anything happened.
          mem.userId !== myUserId &&
          mem.displayName.toLowerCase().startsWith(q),
      )
      .slice(0, 5);
  }, [mentionQuery, members.data, myUserId]);

  function insertMention(displayName: string) {
    const before = draft
      .slice(0, caret)
      .replace(/@[^@\n]*$/, `@${displayName} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    // Restore focus + caret after the inserted mention.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = before.length;
        setCaret(before.length);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    chat.send(text);
    setDraft("");
  }

  return (
    <section className="board__chat" role="dialog" aria-label={t("Trip chat")}>
      <header className="board__chat-head">
        {/* Back before the name, where there is a list to go back to. The
                dock opens onto every board's conversation, so the panel is one
                level down from something — and a panel you can only leave by
                closing it makes switching boards a three-step round trip. */}
        {onBack ? (
          <button
            type="button"
            className="board__chat-back"
            aria-label={t("All conversations")}
            onClick={onBack}
          >
            ‹
          </button>
        ) : null}
        {/*
         * The board's name above the channel's. On a dock that spans every
         * trip, "Stay" as a heading does not say which trip's Stay.
         *
         * **And the whole block is the collapse control.** Pressing the name
         * folds the panel down to a bubble beside the launcher. The name is
         * what a reader points at when they mean "this conversation", and it is
         * the one part of this header that was not already a control — the ‹
         * goes back, the ✕ closes, and between them sat the thing the panel is
         * *about*, doing nothing.
         *
         * A button around both lines rather than around the trip name alone,
         * because which line carries the trip's name depends on the channel:
         * the trip-wide one is named after the board, so its small line is
         * suppressed and the heading is the trip name. One target either way.
         */}
        <button
          type="button"
          className="board__chat-title board__chat-title--btn"
          aria-label={t("Collapse {trip} to a bubble", { trip: tripName })}
          onClick={onCollapse}
        >
          {/*
           * Except where the channel *is* the trip.
           *
           * The trip-wide channel is named after the trip (see `channelName`),
           * so on the channel every chat opens on, the header printed the same
           * name twice — once small and once as the heading, one directly above
           * the other. The small line answers "which trip's Stay?", and on this
           * channel there is no such question to answer.
           *
           * Compared on the rendered name rather than on `channel.type`: they
           * are the same condition today, and this one stays true whatever
           * `channelName` decides tomorrow.
           *
           * Cut by the box, not by a character count. The name used to be
           * shortened to 15 characters wherever it appeared, which on a dock
           * this wide meant "Lisbon — long w…" with room to spare on the line.
           * CSS ends it exactly where the space does, and the full name is on
           * `title` for anyone who wants the rest.
           */}
          {activeChannel && channelName(activeChannel) === tripName ? null : (
            <small className="board__chat-trip" title={tripName}>
              {tripName}
            </small>
          )}
          {/* The heading takes the whole name — it has a line to itself and
              already ends itself with an ellipsis when the box runs out. The
              chips below still count characters, because that is what decides
              how many of them fit (see `useFitCount`). */}
          <strong
            title={activeChannel ? channelName(activeChannel) : undefined}
          >
            {activeChannel ? channelName(activeChannel) : t("Chat")}
          </strong>
        </button>
        <button
          type="button"
          className="board__chat-close"
          aria-label={t("Close chat")}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {listed.length > 1 ? (
        <div className="board__chat-switcher">
          {/* Off-flow copy of the full list, measured to decide how many chips
                  fit. aria-hidden and untabbable — the real row is below.

                  It has to mirror the real row **exactly**, badge for badge. It
                  used to badge every unread channel including the active one,
                  which the real row deliberately does not — so every chip was
                  measured about a badge too wide and the row gave away a chip
                  it had the space for. */}
          <div
            className="board__chat-measure"
            ref={fit.measureRef}
            aria-hidden="true"
          >
            {ordered.map((c) => {
              const badge = c.id === activeChannelId ? 0 : (unread[c.id] ?? 0);
              return (
                <span key={c.id} className="board__chat-tab">
                  {channelLabel(c)}
                  {badge > 0 ? (
                    <span className="board__chat-tabbadge">{badge}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
          {/* And an off-flow copy of the trigger, so the space held back for
                  it is its real width rather than a constant. Drawn at its
                  **widest** — every channel but one collapsed, carrying the
                  trip's whole unread count — because a reserve that is a little
                  too big costs alignment, while one that is too small brings
                  back the horizontal overflow this row exists to avoid. */}
          <button
            type="button"
            disabled
            tabIndex={-1}
            className="menu__trigger board__chat-more board__chat-more--measure"
            ref={fit.reserveRef}
            aria-hidden="true"
          >
            ＋{ordered.length - 1}
            {totalUnread > 0 ? (
              <span className="board__chat-tabbadge">{totalUnread}</span>
            ) : null}
          </button>

          {/* Not a `tablist`: there are no tabpanels and no arrow-key
                  contract to honour, and the overflow trigger could not live
                  inside one. Toggle buttons with aria-pressed say what this is —
                  the same call Menu documents. */}
          <div
            className="board__chat-tabs"
            role="group"
            aria-label={t("Channels")}
            ref={fit.containerRef}
          >
            {/* The chips clip, the overflow menu must not. Only this inner
                    strip carries `overflow: hidden` — when the row itself did,
                    it also clipped the Menu's absolutely-positioned popover to
                    the height of one chip, so every collapsed channel but the
                    first was unreachable. The strip spans the row, so the fit
                    arithmetic (which measures the row) is unaffected. */}
            <div className="board__chat-strip">
              {shownChannels.map((c) => {
                const isActive = c.id === activeChannelId;
                const badge = !isActive ? (unread[c.id] ?? 0) : 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={isActive}
                    title={channelName(c)}
                    className={
                      "board__chat-tab" +
                      (isActive ? " board__chat-tab--active" : "")
                    }
                    onClick={() => selectChannel(c.id)}
                  >
                    {channelLabel(c)}
                    {badge > 0 ? (
                      <span
                        className="board__chat-tabbadge"
                        aria-label={t("{n} unread", { n: badge })}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {hiddenChannels.length > 0 ? (
              <Menu
                label={
                  hiddenUnread > 0
                    ? `${hiddenChannels.length} more channels, ${hiddenUnread} unread`
                    : `${hiddenChannels.length} more channels`
                }
                triggerClassName="board__chat-more"
                trigger={
                  <>
                    ＋{hiddenChannels.length}
                    {hiddenUnread > 0 ? (
                      <span className="board__chat-tabbadge" aria-hidden="true">
                        {hiddenUnread}
                      </span>
                    ) : null}
                  </>
                }
                items={hiddenChannels.map((c) => ({
                  label: channelName(c),
                  badge: unread[c.id] ?? 0,
                  selected: c.id === activeChannelId,
                  onSelect: () => selectChannel(c.id),
                }))}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="board__chat-log" ref={logRef}>
        {chat.status === "loading" ? (
          <p className="board__muted" role="status">
            {t("Loading messages…")}
          </p>
        ) : chat.status === "error" ? (
          <>
            <p className="board__form-error" role="alert">
              {t("Couldn't load chat.")}
            </p>
            <button
              type="button"
              className="board__chat-older"
              onClick={chat.reload}
            >
              {t("Try again")}
            </button>
          </>
        ) : (
          <>
            {chat.hasMore ? (
              <button
                type="button"
                className="board__chat-older"
                disabled={chat.loadingOlder}
                onClick={chat.loadOlder}
              >
                {chat.loadingOlder ? t("Loading…") : t("Load older messages")}
              </button>
            ) : null}
            {chat.messages.length === 0 ? (
              <p className="board__muted">
                {t(
                  "No messages yet. Say hello, or @mention someone to pull them in.",
                )}
              </p>
            ) : (
              <ul className="board__msg-list">
                {chat.messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    myRole={myRole}
                    myUserId={myUserId}
                    onDelete={chat.remove}
                    onToggleReaction={chat.toggleReaction}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <form className="board__chat-composer" onSubmit={onSubmit}>
        {suggestions.length > 0 ? (
          <ul className="board__mention-menu" role="listbox">
            {suggestions.map((mem) => (
              <li key={mem.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => insertMention(mem.displayName)}
                >
                  @{mem.displayName}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={inputRef}
          data-gtp-input
          className="board__chat-input"
          rows={2}
          placeholder={t("Message the group… @ to mention")}
          aria-label={t("Message")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          {t("Send")}
        </Button>
      </form>
    </section>
  );
}
