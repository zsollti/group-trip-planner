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

/**
 * Trip name: required, human-facing, bounded.
 *
 * The messages are written out because they are **shown to people**. Zod's
 * defaults read "String must contain at least 1 character(s)", which is a
 * sentence about a type rather than about the trip someone is naming — and the
 * create form now validates this on the first Next, so it is the first thing a
 * new user can be told.
 */
export const tripNameSchema = z
  .string()
  .trim()
  .min(1, "Give the trip a name.")
  .max(120, "That name is too long — 120 characters at most.");

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

/** Optional ISO date-time; empty normalises to undefined. */
const optionalDateTime = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().datetime({ offset: true }).optional(),
);

/**
 * What the group is aiming to spend **each**, in the trip's `defaultCurrency`.
 *
 * A target, not a limit: nothing is refused for exceeding it and no option
 * validates against it. The trip's cost is an emergent property of what the
 * lanes decide, and this is the number to read it against — which is exactly
 * why it lives on the trip rather than in a lane. A Budget *category* was tried
 * and retired: a lane holds competing options you vote between and lock one of,
 * and "€800 per person" is not a candidate for anything. Worse, it was
 * double-counted, since the cost engine sums every locked option in every
 * category (see `docs/decisions.md`).
 *
 * Per person rather than per group because that is the figure anyone can act
 * on — a group total means nothing until you have divided it by a headcount
 * that is still moving.
 *
 * No currency of its own: it is denominated in the trip's, or it would be a
 * second source of truth for a question the trip already answers.
 */
const optionalBudget = z.preprocess(
  (v) =>
    v === "" || v === null || (typeof v === "number" && Number.isNaN(v))
      ? undefined
      : v,
  z.number().nonnegative().max(1_000_000_000).optional(),
);

/**
 * Create a trip. `startDate`/`endDate` are **optional and all-or-nothing**: a
 * group that already knows when it is going says so here, and the trip is seeded
 * with its Dates decision already made rather than being asked a question it has
 * answered (post-launch).
 *
 * They are not a second way to store the trip's dates. A trip's dates have
 * exactly one writer — locking an option in the Dates category — so supplying
 * them here seeds a **pre-locked Dates option** and lets the ordinary write-back
 * set the columns. Reopening the question is then the ordinary unlock, not a
 * special case. The same `planLockedDates` rules apply (no past start, nothing
 * beyond the planning horizon), so nothing can enter through create that could
 * not be locked afterwards.
 */
export const CreateTripInput = z
  .object({
    name: tripNameSchema,
    description: optionalText(2000),
    destination: optionalText(120),
    defaultCurrency: currencySchema,
    budgetPerPerson: optionalBudget,
    startDate: optionalDateTime,
    endDate: optionalDateTime,
  })
  .superRefine((val, ctx) => {
    // All-or-nothing: one date alone can neither seed a lockable option nor
    // compute an expiry, so it would be silently dropped.
    if ((val.startDate === undefined) !== (val.endDate === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [val.startDate === undefined ? "startDate" : "endDate"],
        message: "Give both dates, or neither.",
      });
    }
    if (
      val.startDate !== undefined &&
      val.endDate !== undefined &&
      Date.parse(val.endDate) < Date.parse(val.startDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End must not be before start.",
      });
    }
  });
export type CreateTripInput = z.infer<typeof CreateTripInput>;

/**
 * Trip-details edit (Phase 1.2). Same editable fields as create, plus the
 * `version` the client last saw — the backend rejects the write with a 409 if
 * the trip has changed since (SRS §6 optimistic concurrency, the "changed since
 * you opened it — reload" path). This is a full-object replace: an omitted
 * optional field clears it.
 */
export const UpdateTripInput = z.object({
  name: tripNameSchema,
  description: optionalText(2000),
  destination: optionalText(120),
  defaultCurrency: currencySchema,
  /** Omitted clears it — this is a replace, and a target you emptied is gone. */
  budgetPerPerson: optionalBudget,
  version: z.number().int().nonnegative(),
});
export type UpdateTripInput = z.infer<typeof UpdateTripInput>;

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
  /** The per-person spending target, in `defaultCurrency`. Null = none set. */
  budgetPerPerson: z.number().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  expiresAt: z.string(),
  status: TripStatus,
  version: z.number().int().nonnegative(),
  role: TripRole,
  memberCount: z.number().int().nonnegative(),
  /**
   * Whether the caller muted this trip's notification **email** (Phase 5.3).
   * The in-app bell is unaffected — muting quiets the inbox, not the app.
   */
  viewerMuted: z.boolean(),
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
