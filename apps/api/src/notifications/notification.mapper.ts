import type { Notification } from "@prisma/client";
import type { NotificationType, NotificationView } from "@gtp/types";

/**
 * The denormalized snapshot stored in `Notification.payload` (Phase 5.1). Taken
 * at fan-out time so the bell renders without joining the trip, the actor, or a
 * subject that may since have been edited, soft-deleted, or anonymized.
 */
export interface NotificationPayload {
  tripName: string;
  actorName: string | null;
  subject: string;
  categoryId?: string | null;
  channelId?: string | null;
}

/** Read the JSON payload back defensively — a row written by an older shape must
 * still render rather than throw in the middle of a page. */
function readPayload(value: unknown): NotificationPayload {
  const p = (value ?? {}) as Partial<NotificationPayload>;
  return {
    tripName: typeof p.tripName === "string" ? p.tripName : "",
    actorName: typeof p.actorName === "string" ? p.actorName : null,
    subject: typeof p.subject === "string" ? p.subject : "",
    categoryId: typeof p.categoryId === "string" ? p.categoryId : null,
    channelId: typeof p.channelId === "string" ? p.channelId : null,
  };
}

/** Prisma row → the client-facing {@link NotificationView}. */
export function toNotificationView(row: Notification): NotificationView {
  const payload = readPayload(row.payload);
  return {
    id: row.id,
    type: row.type as NotificationType,
    tripId: row.tripId,
    tripName: payload.tripName,
    actorName: payload.actorName,
    subject: payload.subject,
    categoryId: payload.categoryId ?? null,
    channelId: payload.channelId ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
