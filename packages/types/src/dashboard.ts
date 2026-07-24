import { z } from "zod";

/**
 * Per-trip cost dashboard contract (Phase 3.2, SRS §6 / FR-26–27) — the wire
 * shape of `GET /trips/:id/dashboard`. The figures themselves are produced by the
 * pure cost engine ({@link ../cost}); this module only defines how they cross the
 * FE/BE boundary. The three front-ends render the same object in their own
 * paradigm (Deck ledger / Feed cost card / Board tally).
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
