import type { AuditEvent, TripRole } from "@prisma/client";
import type { ActivityEvent } from "@gtp/types";
import type { AuditMetadata } from "./audit.js";

type AuditEventWithActor = AuditEvent & {
  actor: { displayName: string; anonymizedAt: Date | null } | null;
};

/**
 * Turn an audit row into a feed line (Phase 5.4).
 *
 * The actor's name is read **live** from the joined user when it is still
 * available, and falls back to null once the account is anonymized — the row is
 * kept either way (history outlives accounts), and the pure `activityHeadline`
 * renders the gap as "Someone". Everything else comes from the metadata
 * snapshot taken at write time, so an event still reads correctly after its
 * subject was renamed, soft-deleted, or removed from the trip.
 */
export function toActivityEvent(row: AuditEventWithActor): ActivityEvent {
  const metadata = (row.metadata ?? {}) as AuditMetadata;
  const anonymized = row.actor?.anonymizedAt != null;

  return {
    id: row.id,
    action: row.action,
    actorName: anonymized ? null : (row.actor?.displayName ?? null),
    targetName: metadata.targetName ?? null,
    subject: metadata.optionTitle ?? null,
    fromRole: (metadata.fromRole as TripRole | undefined) ?? null,
    toRole: (metadata.toRole as TripRole | undefined) ?? null,
    superseded: metadata.superseded === true,
    createdAt: row.createdAt.toISOString(),
  };
}
