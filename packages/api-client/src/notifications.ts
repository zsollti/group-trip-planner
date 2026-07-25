import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import {
  NOTIFICATION_NEW_EVENT,
  type NotificationPage,
  type NotificationView,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for the notification bell. */
export const notificationKeys = {
  all: ["notifications"] as const,
  list: (limit: number) => [...notificationKeys.all, "list", limit] as const,
};

/** What the mark-read routes return: the corrected badge count. */
interface UnreadCount {
  unreadCount: number;
}

/**
 * The newest page of the caller's notifications plus their total unread count
 * (Phase 5.1). Fetched on mount and refreshed on window focus, so a user who was
 * away — or was never connected to a socket — still sees what they missed. Live
 * arrivals are folded into this same cache by {@link useNotificationLiveSync}.
 */
export function useNotifications(
  limit = 20,
): UseQueryResult<NotificationPage, ApiError> {
  return useQuery({
    queryKey: notificationKeys.list(limit),
    queryFn: () => apiFetch<NotificationPage>(`/notifications?limit=${limit}`),
    refetchOnWindowFocus: true,
  });
}

/** Mark one notification read (idempotent). Invalidates the bell so the badge
 * and the row's read state come back from the server. */
export function useMarkNotificationRead(): UseMutationResult<
  UnreadCount,
  ApiError,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<UnreadCount>(`/notifications/${id}/read`, { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Mark every unread notification read ("clear the badge"). */
export function useMarkAllNotificationsRead(): UseMutationResult<
  UnreadCount,
  ApiError,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<UnreadCount>("/notifications/read-all", { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/**
 * Keep the bell live off the trip socket (Phase 5.1). The server pushes
 * `notification:new` into the recipient's **personal** room, so this fires for
 * activity on *any* of their trips while they happen to have one trip open.
 *
 * Unlike the board's live sync, the payload is the complete notification, so it
 * is prepended straight into the cached page (deduped by id) and the unread count
 * bumped — no refetch, and the toast can render immediately. `onArrive` is called
 * for each new notification so a surface can show that toast.
 */
export function useNotificationLiveSync(
  socket: Socket | null,
  onArrive?: (notification: NotificationView) => void,
  limit = 20,
): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!socket) return;
    const onNew = (notification: NotificationView) => {
      qc.setQueryData<NotificationPage>(
        notificationKeys.list(limit),
        (prev) => {
          if (!prev) return prev;
          if (prev.notifications.some((n) => n.id === notification.id)) {
            return prev;
          }
          return {
            ...prev,
            notifications: [notification, ...prev.notifications].slice(0, limit),
            unreadCount: prev.unreadCount + 1,
          };
        },
      );
      onArrive?.(notification);
    };
    socket.on(NOTIFICATION_NEW_EVENT, onNew);
    return () => {
      socket.off(NOTIFICATION_NEW_EVENT, onNew);
    };
  }, [socket, qc, onArrive, limit]);
}
