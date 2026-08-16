import type { NotificationType, NotificationView } from "@gtp/types";

/**
 * How a notification reads, shared by the list and the toast.
 *
 * These lived inside the bell component until the list moved into the account
 * menu and the toast stayed behind in the header — two components drawing the
 * same row. A headline that drifts between where you *see* a notification and
 * where you *dismiss* it is the kind of difference nobody notices while writing
 * it and everybody notices in use.
 */

/** The glyph that fronts each row — a quick visual type cue next to the text. */
export const NOTIFICATION_ICON: Record<NotificationType, string> = {
  OPTION_PROPOSED: "✦",
  OPTION_LOCKED: "🔒",
  MENTION: "＠",
};

/** The one-line summary of a notification, in the actor's voice. */
export function notificationHeadline(n: NotificationView): string {
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

/** Coarse relative time — precise enough for a list, no date library. */
export function notificationAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
