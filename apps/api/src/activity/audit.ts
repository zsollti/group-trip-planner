import type { Prisma, TripRole } from "@prisma/client";
import type { ActivityAction } from "@gtp/types";

/**
 * Builders for {@link AuditEvent} rows (Phase 5.4).
 *
 * Every one of these is meant to be called **inside the transaction that
 * performs the action** — that is what makes the activity feed trustworthy: a
 * kick and its audit row commit or roll back together, so the log can never
 * claim something that did not happen, or miss something that did.
 *
 * The `metadata` snapshot is deliberate. Names and titles are copied in at write
 * time rather than joined at read time, so an event still renders after the
 * member is gone, the option is soft-deleted, or the actor's account has been
 * anonymized (`actorId` is `SetNull`, and the retained snapshot is all that is
 * left of who did it).
 */

/** What the feed's mapper expects to find in `AuditEvent.metadata`. */
export interface AuditMetadata {
  /** Display name of the member an action targeted. */
  targetName?: string;
  /** Title of the option a decision was about. */
  optionTitle?: string;
  /** Role change: the roles either side of it. */
  fromRole?: TripRole;
  toRole?: TripRole;
  /** Lock only: this lock displaced a previously locked sibling. */
  superseded?: boolean;
}

function row(
  tripId: string,
  actorId: string,
  action: ActivityAction,
  targetType: "OPTION" | "MEMBER",
  targetId: string | null,
  metadata: AuditMetadata,
): Prisma.AuditEventUncheckedCreateInput {
  return {
    tripId,
    actorId,
    action,
    targetType,
    targetId,
    metadata: metadata as Prisma.InputJsonValue,
  };
}

/** A lock or unlock on an option (Phase 2.4). */
export function optionAudit(
  tripId: string,
  actorId: string,
  action: "OPTION_LOCKED" | "OPTION_UNLOCKED",
  optionId: string,
  metadata: AuditMetadata,
): Prisma.AuditEventUncheckedCreateInput {
  return row(tripId, actorId, action, "OPTION", optionId, metadata);
}

/**
 * A membership action (Phase 5.4 retrofit). `targetUserId` is stored as a plain
 * id, not an FK — the member may later be deleted, and the history stays.
 */
export function memberAudit(
  tripId: string,
  actorId: string,
  action: Exclude<ActivityAction, "OPTION_LOCKED" | "OPTION_UNLOCKED">,
  targetUserId: string,
  metadata: AuditMetadata,
): Prisma.AuditEventUncheckedCreateInput {
  return row(tripId, actorId, action, "MEMBER", targetUserId, metadata);
}
