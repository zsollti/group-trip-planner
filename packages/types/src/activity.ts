import { z } from "zod";
import { TripRole } from "./trips.js";

/**
 * The trip activity feed (Phase 5.4, SRS FR-33) — the "what did I miss?" view.
 *
 * The feed is a **read of the audit log**, not a second record of what happened.
 * Every event is written inside the same transaction as the action it describes,
 * so the log cannot drift from the decisions it reports; this file only defines
 * how those rows are shown.
 *
 * Everything needed to render a line is **snapshotted at write time** — the
 * actor's and target's names, the option's title, the roles involved. An event
 * from six weeks ago still reads correctly after the member was kicked, the
 * option soft-deleted, or the actor's account anonymized.
 */

/** What happened. Mirrors the `AuditAction` enum; never renumbered. */
export const ActivityAction = z.enum([
  "OPTION_LOCKED",
  "OPTION_UNLOCKED",
  "MEMBER_ROLE_CHANGED",
  "MEMBER_KICKED",
  "MEMBER_BLOCKED",
  "MEMBER_UNBLOCKED",
  "MEMBER_LEFT",
  "OWNERSHIP_TRANSFERRED",
]);
export type ActivityAction = z.infer<typeof ActivityAction>;

/**
 * One event as the feed renders it.
 *
 * `actorName` is null when the actor's account has since been anonymized (the
 * row is retained on purpose — history outlives accounts). `targetName` is the
 * member an action was aimed at, or null for the option decisions, which name
 * their subject in `subject` instead.
 */
export const ActivityEvent = z.object({
  id: z.string().uuid(),
  action: ActivityAction,
  /** Display name of whoever acted, snapshotted. Null once anonymized. */
  actorName: z.string().nullable(),
  /** The member acted upon, snapshotted. Null for option events. */
  targetName: z.string().nullable(),
  /** The option's title for a lock/unlock; null otherwise. */
  subject: z.string().nullable(),
  /** Role change only: what the target held before and after. */
  fromRole: TripRole.nullable(),
  toRole: TripRole.nullable(),
  /**
   * True when a lock displaced a previously locked sibling in a single-choice
   * category — the feed says "replacing the earlier pick" rather than showing an
   * unexplained unlock (Phase 2.4).
   */
  superseded: z.boolean(),
  createdAt: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/** One page of the feed, newest first. */
export const ActivityPage = z.object({
  events: z.array(ActivityEvent),
  /** Cursor for the next (older) page; null when the log is exhausted. */
  nextCursor: z.string().nullable(),
});
export type ActivityPage = z.infer<typeof ActivityPage>;

/** How a role reads in a feed line. */
const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

/**
 * The one-line summary of an event — pure, so the wording is defined once and
 * tested without a database or a renderer.
 *
 * Names that are missing (an anonymized actor, a snapshot written before this
 * slice) degrade to "Someone"/"a member" rather than rendering an empty gap:
 * a feed line with a hole in it reads like a bug, and the *event* is still true
 * even when the name is gone.
 */
export function activityHeadline(event: ActivityEvent): string {
  const actor = event.actorName ?? "Someone";
  const target = event.targetName ?? "a member";
  const subject = event.subject ?? "an option";

  switch (event.action) {
    case "OPTION_LOCKED":
      return event.superseded
        ? `${actor} locked in “${subject}”, replacing the earlier pick`
        : `${actor} locked in “${subject}”`;
    case "OPTION_UNLOCKED":
      return `${actor} reopened “${subject}”`;
    case "MEMBER_ROLE_CHANGED":
      return event.fromRole && event.toRole
        ? `${actor} changed ${target} from ${ROLE_LABEL[event.fromRole]} to ${ROLE_LABEL[event.toRole]}`
        : `${actor} changed ${target}'s role`;
    case "MEMBER_KICKED":
      return `${actor} removed ${target}`;
    case "MEMBER_BLOCKED":
      return `${actor} blocked ${target}`;
    case "MEMBER_UNBLOCKED":
      return `${actor} unblocked ${target}`;
    case "MEMBER_LEFT":
      return `${actor} left the trip`;
    case "OWNERSHIP_TRANSFERRED":
      return `${actor} handed ownership to ${target}`;
  }
}
