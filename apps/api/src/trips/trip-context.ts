import type { Trip, TripRole } from "@prisma/client";

/**
 * The immutable trip-context the {@link TripContextGuard} resolves once per
 * request and attaches to it. Handlers and services read the caller's role
 * from here — they never re-query it and never trust it from the client or the
 * JWT. This is the IDOR defense (SRS FR-4); the full permission layer in Phase
 * 1.2 builds on this same context.
 */
export interface TripContext {
  /** The resolved trip, with its current membership count eager-loaded. */
  readonly trip: Trip & { _count: { memberships: number } };
  /** The caller's role in this trip, loaded fresh from their membership row. */
  readonly role: TripRole;
  /** The caller's membership id (used by role/leave mutations in later slices). */
  readonly membershipId: string;
}

/** Request augmented with the resolved trip-context. */
export interface RequestWithTripContext {
  tripContext?: TripContext;
}
