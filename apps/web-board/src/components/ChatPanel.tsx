import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  useChat,
  useTripMembers,
  type ChatMessage,
  type TripSocket,
} from "@gtp/api-client";
import {
  canDeleteMessage,
  REACTION_EMOJIS,
  type MentionView,
  type TripRole,
} from "@gtp/types";
import { Button } from "@gtp/ui-primitives";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
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
        <span className="board__msg-body">message deleted</span>
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
        <span className="board__msg-author">{message.authorName}</span>
        <span className="board__msg-time">
          {message.failed ? "not sent" : timeLabel(message.createdAt)}
        </span>
        {canDelete ? (
          <button
            type="button"
            className="board__msg-del"
            aria-label="Delete message"
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
              aria-label={`${g.emoji} ${g.userIds.length}`}
              onClick={() => onToggleReaction(message.id, g.emoji)}
            >
              {g.emoji} {g.userIds.length}
            </button>
          ))}
          <div className="board__reaction-add">
            <button
              type="button"
              className="board__reaction-addbtn"
              aria-label="Add reaction"
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
                    aria-label={`React ${e}`}
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
 * Trip chat (Phase 4.2, +reactions/@mentions in 4.3). A collapsible docked panel
 * over the shared trip socket: live send/receive with optimistic sends,
 * soft-delete tombstones, cursor "load older", public emoji reactions, and
 * @mention autocomplete + highlighting. Chat stays open in a History trip (chat
 * is exempt from the freeze, FR-10). Drives the General channel for now.
 */
export function ChatPanel({
  tripId,
  tripSocket,
  myRole,
  myUserId,
}: {
  tripId: string;
  tripSocket: TripSocket;
  myRole: TripRole;
  myUserId: string | undefined;
}) {
  const { socket, channels, unread, markChannelRead, setActiveChannel } =
    tripSocket;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const general = channels.find((c) => c.type === "GENERAL");
  const chat = useChat(socket, tripId, general?.id, myUserId);
  const members = useTripMembers(open ? tripId : undefined);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unreadCount = general ? (unread[general.id] ?? 0) : 0;

  function openPanel() {
    setOpen(true);
    setActiveChannel(general?.id ?? null);
  }
  function closePanel() {
    setOpen(false);
    setActiveChannel(null);
  }

  // Keep the newest message in view as the log grows, and keep the channel
  // marked read while it's open so new arrivals don't re-badge.
  const count = chat.messages.length;
  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
    if (open && general) markChannelRead(general.id);
  }, [open, count, general, markChannelRead]);

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
      .filter((mem) => mem.displayName.toLowerCase().startsWith(q))
      .slice(0, 5);
  }, [mentionQuery, members.data]);

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
    <>
      <button
        type="button"
        className="board__chat-fab"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 && !open ? `Chat, ${unreadCount} unread` : "Chat"
        }
        onClick={() => (open ? closePanel() : openPanel())}
      >
        💬 Chat
        {!open && unreadCount > 0 ? (
          <span className="board__chat-badge" aria-hidden="true">
            {unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <section className="board__chat" role="dialog" aria-label="Trip chat">
          <header className="board__chat-head">
            <strong>Chat</strong>
            <button
              type="button"
              className="board__chat-close"
              aria-label="Close chat"
              onClick={closePanel}
            >
              ×
            </button>
          </header>

          <div className="board__chat-log" ref={logRef}>
            {chat.status === "loading" ? (
              <p className="board__muted">Loading messages…</p>
            ) : chat.status === "error" ? (
              <p className="board__form-error" role="alert">
                Couldn't load chat.
              </p>
            ) : (
              <>
                {chat.hasMore ? (
                  <button
                    type="button"
                    className="board__chat-older"
                    disabled={chat.loadingOlder}
                    onClick={chat.loadOlder}
                  >
                    {chat.loadingOlder ? "Loading…" : "Load older messages"}
                  </button>
                ) : null}
                {chat.messages.length === 0 ? (
                  <p className="board__muted">No messages yet — say hello.</p>
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
              placeholder="Message the group… @ to mention"
              aria-label="Message"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCaret(e.target.selectionStart);
              }}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
              onClick={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  suggestions.length === 0
                ) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
            />
            <Button type="submit" variant="primary" disabled={!draft.trim()}>
              Send
            </Button>
          </form>
        </section>
      ) : null}
    </>
  );
}
