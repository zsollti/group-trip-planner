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
export function NotificationToasts({ socket }: { socket?: LiveSocket | null }) {
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();
  const [toast, setToast] = useState<NotificationView | null>(null);

  const onArrive = useCallback((n: NotificationView) => setToast(n), []);
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
