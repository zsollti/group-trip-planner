import type { Trip, TripRole } from "@prisma/client";
import {
  isTripFrozen,
  type TripDetail,
  type TripPreview,
  type TripStatus,
  type TripSummary,
} from "@gtp/types";

type TripWithCount = Trip & { _count: { memberships: number } };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * The trip's **effective** status for display (Phase 2.5, decision 4). A trip
 * past its `expiresAt` reads as History even before the scheduled expiry job has
 * persisted the flip — reads and the planning-mutation guard agree without
 * depending on the job firing.
 */
function effectiveStatus(trip: Trip): TripStatus {
  return isTripFrozen(trip.status, trip.expiresAt.toISOString())
    ? "HISTORY"
    : trip.status;
}

/** A trip as it appears in the caller's list, tagged with the caller's role. */
export function toTripSummary(
  trip: TripWithCount,
  role: TripRole,
): TripSummary {
  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: iso(trip.startDate),
    endDate: iso(trip.endDate),
    status: effectiveStatus(trip),
    role,
    memberCount: trip._count.memberships,
    createdAt: trip.createdAt.toISOString(),
  };
}

/** Full trip detail for a member, carrying their role and the edit `version`. */
export function toTripDetail(trip: TripWithCount, role: TripRole): TripDetail {
  return {
    id: trip.id,
    name: trip.name,
    description: trip.description,
    destination: trip.destination,
    coverImageUrl: trip.coverImageUrl,
    defaultCurrency: trip.defaultCurrency,
    startDate: iso(trip.startDate),
    endDate: iso(trip.endDate),
    expiresAt: trip.expiresAt.toISOString(),
    status: effectiveStatus(trip),
    version: trip.version,
    role,
    memberCount: trip._count.memberships,
    createdAt: trip.createdAt.toISOString(),
  };
}

/** Public Visitor-scope preview — only the four allowed fields + member count. */
export function toTripPreview(trip: TripWithCount): TripPreview {
  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: iso(trip.startDate),
    endDate: iso(trip.endDate),
    memberCount: trip._count.memberships,
  };
}
