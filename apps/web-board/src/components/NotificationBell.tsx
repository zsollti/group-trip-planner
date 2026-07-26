import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationLiveSync,
  useNotifications,
  type LiveSocket,
} from "@gtp/api-client";
import type { NotificationType, NotificationView } from "@gtp/types";

/** How long a live toast stays on screen before dismissing itself. */
const TOAST_MS = 6000;

/** The glyph that fronts each row — a quick visual type cue next to the text. */
const ICON: Record<NotificationType, string> = {
  OPTION_PROPOSED: "✦",
  OPTION_LOCKED: "🔒",
  MENTION: "＠",
};

/** The one-line summary of a notification, in the actor's voice. */
function headline(n: NotificationView): string {
  const who = n.actorName ?? "Someone";
  switch (n.type) {
    case "OPTION_PROPOSED":
      return `${who} proposed “${n.subject}”`;
    case "OPTION_LOCKED":
      return `${who} locked in “${n.subject}”`;
    case "MENTION":
      return `${who} mentioned you: “${n.subject}”`;
  }
}

/** Coarse relative time — precise enough for a bell, no date library. */
function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The notification bell (Phase 5.1): unread badge, a popover of the newest
 * notifications, mark-read (per row and all at once), and a toast for anything
 * that arrives while the user is looking at something else.
 *
 * Live arrivals ride the trip socket's **personal** room, so passing the open
 * trip's socket keeps the badge live for *every* trip the user belongs to, not
 * just the one on screen. On surfaces with no socket (the boards overview) the
 * list is simply fetched, and refetched on window focus — the DoD's "live if
 * connected, on load otherwise".
 *
 * Follows the {@link Menu} popover conventions rather than an ARIA menu widget:
 * `aria-haspopup`/`aria-expanded` on the trigger, Escape and outside-click to
 * close, plain buttons inside.
 */
export function NotificationBell({ socket }: { socket?: LiveSocket | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<NotificationView | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const list = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // A live arrival toasts only when the panel is closed — if it's open the user
  // is already looking at the list, and a toast on top of it is just noise.
  const openRef = useRef(open);
  openRef.current = open;
  const onArrive = useCallback((n: NotificationView) => {
    if (!openRef.current) setToast(n);
  }, []);
  useNotificationLiveSync(socket ?? null, onArrive);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const notifications = list.data?.notifications ?? [];
  const unread = list.data?.unreadCount ?? 0;

  /** Open what a notification is about, marking it read on the way. */
  function go(n: NotificationView) {
    setOpen(false);
    setToast(null);
    if (!n.readAt) markRead.mutate(n.id);
    navigate(`/trips/${n.tripId}`);
  }

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="bell__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span className="bell__badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="bell__panel" aria-label="Notifications">
          <div className="bell__head">
            <span className="bell__title">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                className="board__link-btn"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {list.isPending ? (
            <div className="bell__state" aria-busy="true">
              Loading…
            </div>
          ) : list.isError ? (
            <div className="bell__state" role="alert">
              Couldn&apos;t load notifications.{" "}
              <button
                type="button"
                className="board__link-btn"
                onClick={() => void list.refetch()}
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="bell__state">
              Nothing yet. Proposals, decisions and mentions land here.
            </div>
          ) : (
            <ul className="bell__list">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={
                      "bell__item" + (n.readAt ? "" : " bell__item--unread")
                    }
                    onClick={() => go(n)}
                  >
                    <span className="bell__icon" aria-hidden="true">
                      {ICON[n.type]}
                    </span>
                    <span className="bell__body">
                      <span className="bell__text">{headline(n)}</span>
                      <span className="bell__meta">
                        {n.tripName} · {ago(n.createdAt)}
                      </span>
                    </span>
                    {n.readAt ? null : (
                      <span className="bell__dot" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {toast ? (
        <div className="bell__toast" role="status">
          <span className="bell__icon" aria-hidden="true">
            {ICON[toast.type]}
          </span>
          <button
            type="button"
            className="bell__toast-body"
            onClick={() => go(toast)}
          >
            <span className="bell__text">{headline(toast)}</span>
            <span className="bell__meta">{toast.tripName}</span>
          </button>
          <button
            type="button"
            className="bell__toast-close"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
