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
    chatImageUrl: trip.chatImageUrl,
  };
}

/**
 * Full trip detail for a member, carrying their role, the edit `version`, and
 * whether they muted this trip's notification email (Phase 5.3) so the mute
 * control renders in the right state on first paint.
 */
export function toTripDetail(
  trip: TripWithCount,
  role: TripRole,
  muted = false,
): TripDetail {
  return {
    viewerMuted: muted,
    id: trip.id,
    name: trip.name,
    description: trip.description,
    destination: trip.destination,
    // What the destination resolved to, when it was chosen rather than typed.
    // All four are null on every trip made before the picker existed, and on
    // every one whose destination is a phrase the gazetteer has never heard of.
    destinationPlaceId: trip.destinationPlaceId,
    destinationTimezone: trip.destinationTimezone,
    destinationLat: trip.destinationLat,
    destinationLon: trip.destinationLon,
    coverImageUrl: trip.coverImageUrl,
    chatImageUrl: trip.chatImageUrl,
    defaultCurrency: trip.defaultCurrency,
    // Prisma hands Decimal back as its own object; the wire carries a number,
    // the same normalisation `toOptionView` does for an option's amount.
    budgetPerPerson:
      trip.budgetPerPerson === null ? null : Number(trip.budgetPerPerson),
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
