import type { Trip, TripRole } from "@prisma/client";
import type { TripDetail, TripPreview, TripSummary } from "@gtp/types";

type TripWithCount = Trip & { _count: { memberships: number } };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

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
    status: trip.status,
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
    status: trip.status,
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
