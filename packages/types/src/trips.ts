import { z } from "zod";

/**
 * Trips contract (Phase 1.1) — the shared source of truth for the trip create
 * and read boundary. The backend validates requests with these schemas; the
 * front-ends drive forms and typed API hooks from the inferred types, so a
 * contract change that isn't matched on both sides breaks the typecheck.
 */

/** Role hierarchy within a trip (SRS §3). Visitor is not a role. */
export const TripRole = z.enum([
  "OWNER",
  "CO_ORGANIZER",
  "PARTICIPANT",
  "GUEST",
]);
export type TripRole = z.infer<typeof TripRole>;

/** Active trips accept planning mutations; History trips are frozen. */
export const TripStatus = z.enum(["ACTIVE", "HISTORY"]);
export type TripStatus = z.infer<typeof TripStatus>;

/** Trip name: required, human-facing, bounded. */
export const tripNameSchema = z.string().trim().min(1).max(120);

/** Optional free-text fields, trimmed; empty string normalises to undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** ISO-4217-ish currency code: three uppercase letters. Defaults to EUR. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code")
  .default("EUR");

export const CreateTripInput = z.object({
  name: tripNameSchema,
  description: optionalText(2000),
  destination: optionalText(120),
  defaultCurrency: currencySchema,
});
export type CreateTripInput = z.infer<typeof CreateTripInput>;

/**
 * A trip as it appears in the caller's trip list. `role` is the caller's own
 * role in that trip; `memberCount` is the current membership size.
 */
export const TripSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: TripStatus,
  role: TripRole,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type TripSummary = z.infer<typeof TripSummary>;

/** Full trip detail returned to a member. Carries the caller's `role` and the
 * `version` used for the optimistic-concurrency edit path. */
export const TripDetail = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  destination: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  defaultCurrency: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  expiresAt: z.string(),
  status: TripStatus,
  version: z.number().int().nonnegative(),
  role: TripRole,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type TripDetail = z.infer<typeof TripDetail>;

/**
 * Public Visitor-scope preview (SRS §3): only the four allowed fields plus the
 * member count. Never leaks membership, description, or internal identifiers
 * beyond the trip id already in the URL.
 */
export const TripPreview = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
});
export type TripPreview = z.infer<typeof TripPreview>;
