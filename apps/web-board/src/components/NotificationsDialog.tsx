import { useNavigate } from "react-router-dom";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@gtp/api-client";
import type { NotificationView } from "@gtp/types";
import { Dialog } from "./Dialog";
import {
  NOTIFICATION_ICON,
  notificationAgo,
  notificationHeadline,
} from "../lib/notifications";
import { t } from "../lib/i18n";

/**
 * The notification list, opened from the account menu.
 *
 * It was a popover hanging off its own bell in the header until that bell was
 * the third trigger competing for the top-right corner. The account menu
 * already collects the things that are about *you* rather than about this trip
 * — the theme, your settings, your session — and notifications are squarely
 * one of those, so they moved in with them and the bell was retired.
 *
 * A dialog rather than a second popover: it is opened *from* a popover, and
 * nesting one inside another gives two overlapping dismiss contracts and a
 * focus trap that has to guess which layer Escape meant. The shared
 * {@link Dialog} already answers all of that once.
 */
export function NotificationsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const list = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = list.data?.notifications ?? [];
  const unread = list.data?.unreadCount ?? 0;

  /** Open what a notification is about, marking it read on the way. */
  function go(n: NotificationView) {
    onClose();
    if (!n.readAt) markRead.mutate(n.id);
    navigate(`/trips/${n.tripId}`);
  }

  return (
    <Dialog eyebrow="Account" title={t("Notifications")} onClose={onClose}>
      {unread > 0 ? (
        <div className="bell__head">
          <span className="bell__title">{unread} unread</span>
          <button
            type="button"
            className="board__link-btn"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            {t("Mark all read")}
          </button>
        </div>
      ) : null}

      {list.isPending ? (
        <div className="bell__state" aria-busy="true">
          {t("Loading…")}
        </div>
      ) : list.isError ? (
        <div className="bell__state" role="alert">
          Couldn&apos;t load notifications.{" "}
          <button
            type="button"
            className="board__link-btn"
            onClick={() => void list.refetch()}
          >
            {t("Retry")}
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bell__state">
          {t("Nothing yet. Proposals, decisions and mentions land here.")}
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
                  {NOTIFICATION_ICON[n.type]}
                </span>
                <span className="bell__body">
                  <span className="bell__text">{notificationHeadline(n)}</span>
                  <span className="bell__meta">
                    {n.tripName} · {notificationAgo(n.createdAt)}
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
    </Dialog>
  );
}
