import { z } from "zod";

/**
 * Notifications contract (Phase 5.1, SRS §Phase-5). The in-app channel is the
 * **always-on** one: every trigger writes a notification row per recipient, and
 * pushes it live to any socket that recipient currently has open. Email is a
 * second, *optional* channel layered on in 5.2–5.3 and gated by preferences —
 * nothing here is preference-gated.
 */

/**
 * The three triggers (SRS §Phase-5). `OPTION_PROPOSED` and `OPTION_LOCKED` fan
 * out to the trip; `MENTION` is targeted at the people named in a message.
 */
export const NotificationType = z.enum([
  "OPTION_PROPOSED",
  "OPTION_LOCKED",
  "MENTION",
]);
export type NotificationType = z.infer<typeof NotificationType>;

/**
 * A notification as the bell renders it. Everything needed to draw a row is
 * **denormalized at fan-out time** (trip and actor names, the subject's title),
 * so the list needs no joins and stays readable after the subject is edited,
 * soft-deleted, or the actor's account is anonymized.
 *
 * `categoryId` is present for the option triggers so the client can deep-link
 * into the right lane; `channelId` for a mention so it can open the discussion.
 */
export const NotificationView = z.object({
  id: z.string().uuid(),
  type: NotificationType,
  tripId: z.string().uuid(),
  tripName: z.string(),
  /** Display name of whoever caused it, snapshotted. Null if it was the system. */
  actorName: z.string().nullable(),
  /** The subject's title: the option title, or the message excerpt for a mention. */
  subject: z.string(),
  categoryId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  /** ISO timestamp; null while unread. */
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationView = z.infer<typeof NotificationView>;

/**
 * One page of the bell, newest first, plus the viewer's **total** unread count —
 * which counts every unread notification, not only those on this page, so the
 * badge is correct without fetching everything.
 */
export const NotificationPage = z.object({
  notifications: z.array(NotificationView),
  unreadCount: z.number().int().nonnegative(),
  /** Cursor for the next (older) page; null when the list is exhausted. */
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPage>;

/**
 * Server → client push of a freshly created notification (Phase 5.1). Emitted
 * into the recipient's **personal** room (decision 1), not a trip room: a member
 * who is looking at trip A still gets the bell badge for trip B. Payload is a
 * {@link NotificationView}.
 */
export const NOTIFICATION_NEW_EVENT = "notification:new";

/** A trip member considered for fan-out. */
export interface NotificationCandidate {
  userId: string;
}

/**
 * Who receives a notification (decision 2) — pure, so the rule is stated once and
 * testable without a database.
 *
 * - `OPTION_PROPOSED` / `OPTION_LOCKED` → **every active trip member except the
 *   actor**. Everyone on the trip has a stake in a new proposal or a settled
 *   decision, and the actor already knows what they just did.
 * - `MENTION` → **only the mentioned users**, and only those who are still
 *   members (a stale mention of an ex-member notifies nobody), again minus the
 *   actor: `@`-ing yourself is not an event.
 *
 * Per-trip mute and the email toggle are deliberately *not* applied here — they
 * arrive in 5.3 and gate the **email** channel; the in-app channel stays on.
 * Returns a de-duplicated list of user ids.
 */
export function notificationRecipients(input: {
  type: NotificationType;
  actorId: string;
  members: NotificationCandidate[];
  /** Mentioned user ids; ignored for the non-mention types. */
  mentionedUserIds?: string[];
}): string[] {
  const memberIds = new Set(input.members.map((m) => m.userId));
  const targeted =
    input.type === "MENTION"
      ? (input.mentionedUserIds ?? []).filter((id) => memberIds.has(id))
      : [...memberIds];
  return [...new Set(targeted)].filter((id) => id !== input.actorId);
}
