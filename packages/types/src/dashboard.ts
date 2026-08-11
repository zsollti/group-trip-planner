import { z } from "zod";
import { TripRole, TripStatus } from "./trips.js";

/**
 * Per-trip cost dashboard contract (Phase 3.2, SRS §6 / FR-26–27) — the wire
 * shape of `GET /trips/:id/dashboard`. The figures themselves are produced by the
 * pure cost engine ({@link ../cost}); this module only defines how they cross the
 * FE/BE boundary. The three front-ends render the same object in their own
 * paradigm (Deck ledger / Feed cost card / Board tally).
 *
 * It also carries the **all-trips home** dashboard ({@link HomeDashboardView},
 * Phase 3.4) — the wire shape of `GET /dashboard`, the caller's trips with a
 * per-currency committed cost summary and a pending-decision count.
 */

/** A group + per-person money pair for one currency (never converted, FR-27). */
export const DashboardSubtotal = z.object({
  currency: z.string(),
  /** The group total in this currency. */
  group: z.number(),
  /** The sum of each contributing option's per-head cost in this currency. */
  perPerson: z.number(),
});
export type DashboardSubtotal = z.infer<typeof DashboardSubtotal>;

/**
 * Why a line is in the picture: `LOCKED` options are the exact **committed**
 * total; `FRONT_RUNNER` options are each open category's top-voted proposal,
 * counted only in the **projection** ("if the front-runners win").
 */
export const DashboardLineKind = z.enum(["LOCKED", "FRONT_RUNNER"]);
export type DashboardLineKind = z.infer<typeof DashboardLineKind>;

/** One option's contribution to the totals, with the figures that explain it. */
export const DashboardLine = z.object({
  optionId: z.string().uuid(),
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  title: z.string(),
  kind: DashboardLineKind,
  currency: z.string(),
  group: z.number(),
  perPerson: z.number(),
  /** The headcount the cost was computed against (fixed value or live count). */
  effectiveHeadcount: z.number().int().nonnegative(),
  /** True iff a fixed headcount predates the trip's last membership change. */
  headcountStale: z.boolean(),
});
export type DashboardLine = z.infer<typeof DashboardLine>;

/**
 * The whole per-trip cost picture. `committed` is exact (locked decisions);
 * `projected` adds each open category's front-runner. `lines` breaks both down
 * per option so a UI can show what makes up each currency subtotal.
 * `hasStaleHeadcount` is the trip-level warning — true iff any option that feeds
 * a total has a stale fixed headcount.
 */
export const TripDashboardView = z.object({
  tripId: z.string().uuid(),
  /** The trip's default currency — a stable ordering/emphasis hint for the UI. */
  defaultCurrency: z.string(),
  /**
   * The trip's per-person spending target, in `defaultCurrency`. Null = none.
   *
   * Carried on the cost payload rather than read from the trip: the target only
   * means anything next to the totals, and the surface that draws them fetches
   * this endpoint and not the trip. It is a target, never a constraint — the
   * engine does not know about it and nothing is refused for exceeding it.
   *
   * It can only speak to the `defaultCurrency` subtotal. Totals are never
   * converted (FR-27), so a trip with options priced in three currencies has
   * three per-person figures and this compares to one of them; the UI says so
   * rather than implying the others are covered.
   */
  budgetPerPerson: z.number().nullable(),
  /** Current member count, i.e. the divisor for dynamic-headcount options. */
  memberCount: z.number().int().nonnegative(),
  committed: z.array(DashboardSubtotal),
  projected: z.array(DashboardSubtotal),
  lines: z.array(DashboardLine),
  hasStaleHeadcount: z.boolean(),
  /** When the server computed this snapshot (ISO). */
  generatedAt: z.string(),
});
export type TripDashboardView = z.infer<typeof TripDashboardView>;

/** One currency's committed (locked) group total for a trip's home summary. */
export const HomeTripCost = z.object({
  currency: z.string(),
  /** The locked-decisions group total in this currency (no conversion). */
  committed: z.number(),
});
export type HomeTripCost = z.infer<typeof HomeTripCost>;

/**
 * A trip as it appears on the all-trips home (Phase 3.4). Extends the plain trip
 * list with the two figures the home surfaces: a per-currency **committed cost
 * summary** and the **pending-decision count** (categories with a proposal but
 * no locked option yet — decision 3). `status` is the effective status, so a
 * trip past its expiry reads as History even before the expiry job runs.
 */
export const HomeTripSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: TripStatus,
  role: TripRole,
  memberCount: z.number().int().nonnegative(),
  defaultCurrency: z.string(),
  cost: z.array(HomeTripCost),
  pendingDecisionCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type HomeTripSummary = z.infer<typeof HomeTripSummary>;

/**
 * The all-trips home dashboard (`GET /dashboard`). `trips` is one offset-paginated
 * page (newest first); the front-ends split it into Active and History sections
 * by each trip's `status`. `total` is the caller's full trip count, so a UI can
 * offer "show more".
 */
export const HomeDashboardView = z.object({
  trips: z.array(HomeTripSummary),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type HomeDashboardView = z.infer<typeof HomeDashboardView>;
