import { useEffect, useRef, useState } from "react";
import { useChat, type ChatMessage, type TripSocket } from "@gtp/api-client";
import { canDeleteMessage, type ChannelView, type TripRole } from "@gtp/types";
import { Button } from "@gtp/ui-primitives";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One message row: tombstone, optimistic-pending, failed, or a normal message
 * with a delete affordance for the author or an Organizer. */
function MessageRow({
  message,
  myRole,
  myUserId,
  onDelete,
}: {
  message: ChatMessage;
  myRole: TripRole;
  myUserId: string | undefined;
  onDelete: (id: string) => void;
}) {
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
      <p className="board__msg-body">{message.body}</p>
    </li>
  );
}

/**
 * Trip chat (Phase 4.2). A collapsible docked panel over the shared trip socket:
 * live send/receive with optimistic sends, soft-delete tombstones, and
 * cursor-paged "load older" history. Chat stays open even in a History trip
 * (chat is exempt from the freeze, FR-10), so there is no `frozen` gate here.
 * For now it drives the General channel; category channels arrive in 4.5.
 */
export function ChatPanel({
  tripId,
  channels,
  socket,
  myRole,
  myUserId,
}: {
  tripId: string;
  channels: ChannelView[];
  socket: TripSocket["socket"];
  myRole: TripRole;
  myUserId: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const general = channels.find((c) => c.type === "GENERAL");
  const chat = useChat(socket, tripId, general?.id);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the log grows (only while open).
  const count = chat.messages.length;
  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [open, count]);

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
        onClick={() => setOpen((o) => !o)}
      >
        💬 Chat
      </button>
      {open ? (
        <section className="board__chat" role="dialog" aria-label="Trip chat">
          <header className="board__chat-head">
            <strong>Chat</strong>
            <button
              type="button"
              className="board__chat-close"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
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
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <form className="board__chat-composer" onSubmit={onSubmit}>
            <textarea
              data-gtp-input
              className="board__chat-input"
              rows={2}
              placeholder="Message the group…"
              aria-label="Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
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
