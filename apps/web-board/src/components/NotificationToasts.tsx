import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useMarkNotificationRead,
  useNotificationLiveSync,
  type LiveSocket,
} from "@gtp/api-client";
import type { NotificationView } from "@gtp/types";
import { NOTIFICATION_ICON, notificationHeadline } from "../lib/notifications";
import { t } from "../lib/i18n";

/** How long a live toast stays on screen before dismissing itself. */
const TOAST_MS = 6000;

/**
 * Notifications that arrive while you're looking at something else.
 *
 * Split out of the old header bell when the list moved into the account menu
 * (the bell's own trigger and popover went with it). The toast could not follow
 * it there: it is the half that has to be mounted whether or not any menu is
 * open, because it exists precisely for the moment nobody is looking. It rides
 * the trip socket's **personal** room, so it surfaces arrivals for every trip
 * the user belongs to, not just the one on screen.
 *
 * Renders nothing at all until something lands, so it is free to mount anywhere
 * a socket exists.
 */
export function NotificationToasts({
  socket,
  isTripMuted,
}: {
  socket?: LiveSocket | null;
  /**
   * Whether a board's chat is silenced for this reader (post-launch).
   *
   * Optional so the component still mounts anywhere a socket exists — a caller
   * that does not pass it gets the old behaviour, which is every toast.
   */
  isTripMuted?: (tripId: string) => boolean;
}) {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const [toast, setToast] = useState<NotificationView | null>(null);

  /*
   * A muted board does not interrupt.
   *
   * Only `MENTION` is dropped, because only `MENTION` is chat: the option
   * triggers are the board deciding things, and "mute chat" is not a request to
   * stop being told that a decision was locked while you were away.
   *
   * Dropped at the toast, not at the notification. The row is still written,
   * still unread, and still in the bell — muting silences the interruption, it
   * does not withhold the fact. That is the same promise the unread badges
   * make: still counted, just not shouted.
   */
  const onArrive = useCallback(
    (n: NotificationView) => {
      if (n.type === "MENTION" && isTripMuted?.(n.tripId)) return;
      setToast(n);
    },
    [isTripMuted],
  );
  useNotificationLiveSync(socket ?? null, onArrive);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  function go(n: NotificationView) {
    setToast(null);
    if (!n.readAt) markRead.mutate(n.id);
    navigate(`/trips/${n.tripId}`);
  }

  return (
    <div className="bell__toast" role="status">
      <span className="bell__icon" aria-hidden="true">
        {NOTIFICATION_ICON[toast.type]}
      </span>
      <button
        type="button"
        className="bell__toast-body"
        onClick={() => go(toast)}
      >
        <span className="bell__text">{notificationHeadline(toast)}</span>
        <span className="bell__meta">{toast.tripName}</span>
      </button>
      <button
        type="button"
        className="bell__toast-close"
        aria-label={t("Dismiss notification")}
        onClick={() => setToast(null)}
      >
        ×
      </button>
    </div>
  );
}
