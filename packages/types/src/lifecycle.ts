import type { TripStatus } from "./trips.js";

/**
 * Trip lifecycle + Dates write-back rules (Phase 2.5, SRS FR-8–10,25) — the pure,
 * unit-tested core of the last Planning slice.
 *
 * Two intertwined concerns:
 *  - **Dates write-back:** locking a Dates-category option writes the trip's
 *    `startDate`/`endDate` and starts the expiry clock at `endDate + 1 month`
 *    (FR-8); a past start or an end beyond the planning horizon is rejected
 *    (FR-25). Unlocking reverts to the created-`+1 year` fallback (FR-9).
 *  - **Lifecycle freeze:** a trip is Active until its `expiresAt`, then History
 *    and half-read-only (FR-9/10). A scheduled job persists the transition, but
 *    correctness never depends on the job firing — {@link isTripFrozen} treats
 *    `now > expiresAt` as frozen at read time (decision 4), so a missed job can
 *    never let a stale trip accept a planning mutation.
 *
 * Everything here is pure and time-injectable (`nowMs`), so the write-back
 * validation and the freeze rule are testable without a clock or a DB.
 */

/** Start of the UTC day containing `ms` — for date-only "is it in the past?". */
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** The created-`+1 year` fallback expiry for a trip with no locked dates (FR-9). */
export function fallbackExpiresAt(createdAtMs: number): string {
  const d = new Date(createdAtMs);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

/** Expiry from a locked end date: `endDate + 1 month` (FR-8). */
export function expiryFromEndDate(endMs: number): string {
  const d = new Date(endMs);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

/**
 * Is the trip frozen (History / half-read-only)? True if it is **persisted** as
 * History, OR if `now` is past its `expiresAt` — the defensive read-time check
 * that makes the freeze correct even before the scheduled job runs (decision 4).
 * The backend planning guard and the front-end read-only banner both call this.
 */
export function isTripFrozen(
  status: TripStatus,
  expiresAt: string,
  nowMs: number = Date.now(),
): boolean {
  if (status === "HISTORY") return true;
  return nowMs > new Date(expiresAt).getTime();
}

/** Why a Dates lock was rejected (FR-25) — mapped to a user message by the API. */
export type LockDatesRejection =
  | "NO_DATES"
  | "END_BEFORE_START"
  | "PAST"
  | "OVER_HORIZON";

/**
 * The validated dates + new expiry to write when a Dates option is locked, or a
 * rejection reason. A discriminated union rather than a throw, so the rule stays
 * pure and total (the API maps a rejection to a 400).
 */
export type LockedDatesPlan =
  | { readonly ok: true; startDate: string; endDate: string; expiresAt: string }
  | { readonly ok: false; reason: LockDatesRejection };

/**
 * Validate a Dates option's `startsAt`/`endsAt` at lock time and compute the
 * trip's new expiry (FR-8/25). Rejects when: the option has no dates; the end
 * precedes the start; the start is in the past (date-only, UTC); or the end is
 * beyond `now + horizonDays`. Otherwise returns the dates to write back and the
 * `endDate + 1 month` expiry. Pure — `nowMs` and `horizonDays` are injected.
 */
export function planLockedDates(
  startsAt: string | null,
  endsAt: string | null,
  nowMs: number,
  horizonDays: number,
): LockedDatesPlan {
  if (!startsAt || !endsAt) return { ok: false, reason: "NO_DATES" };
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (end < start) return { ok: false, reason: "END_BEFORE_START" };
  if (startOfUtcDay(start) < startOfUtcDay(nowMs)) {
    return { ok: false, reason: "PAST" };
  }
  const horizonMs = nowMs + horizonDays * 24 * 60 * 60 * 1000;
  if (end > horizonMs) return { ok: false, reason: "OVER_HORIZON" };
  return {
    ok: true,
    startDate: new Date(start).toISOString(),
    endDate: new Date(end).toISOString(),
    expiresAt: expiryFromEndDate(end),
  };
}

/** A trip's settled range — both ends, or nothing (see {@link tripDateRange}). */
export interface TripDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * A trip's dates as a range, or `null` when they are not settled.
 *
 * All-or-nothing, the same rule `CreateTripInput` enforces: one end alone
 * cannot bound anything, so a half-filled trip counts as undecided.
 */
export function tripDateRange(trip: {
  readonly startDate: string | null;
  readonly endDate: string | null;
}): TripDateRange | null {
  if (!trip.startDate || !trip.endDate) return null;
  return { startDate: trip.startDate, endDate: trip.endDate };
}

/**
 * Slack allowed either side of the trip before an option counts as elsewhere.
 *
 * An option's dates are a local wall-clock instant and the trip's are pinned to
 * midday UTC, so an activity on the first morning can sit up to fourteen hours
 * before the trip's own start instant. A full day of slack covers every real
 * offset without needing either value re-interpreted.
 */
const OUTSIDE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Does this option fall **entirely** outside the trip's settled dates?
 *
 * Advisory only, and deliberately so — nothing rejects it. Once the trip's
 * range is settled, an option's dates mean "when within the trip", and a
 * booking a month off is worth pointing at. But the near-misses are all
 * legitimate: a red-eye home leaves on the last day and lands after it, a
 * checkout is the morning after the last night, and an option may be proposed
 * before the range is locked and never revisited. So this asks whether the two
 * fail to overlap at all, not whether the option is neatly contained — a rule
 * that flags the hotel booked in March for a trip in July and stays quiet for
 * everything a traveller would actually do.
 *
 * False negatives are cheap here and false positives are not: a warning shown
 * on a correct option teaches people to ignore warnings.
 */
export function isOutsideTripDates(
  option: {
    readonly startsAt: string | null;
    readonly endsAt: string | null;
  },
  range: TripDateRange | null,
): boolean {
  if (!range) return false;
  const start = option.startsAt ? Date.parse(option.startsAt) : NaN;
  const end = option.endsAt ? Date.parse(option.endsAt) : NaN;
  // A single date is a point: whichever end exists bounds both sides.
  const optionStart = Number.isNaN(start) ? end : start;
  const optionEnd = Number.isNaN(end) ? start : end;
  const tripStart = Date.parse(range.startDate);
  const tripEnd = Date.parse(range.endDate);
  if (
    Number.isNaN(optionStart) ||
    Number.isNaN(optionEnd) ||
    Number.isNaN(tripStart) ||
    Number.isNaN(tripEnd)
  ) {
    return false;
  }
  return (
    optionEnd < tripStart - OUTSIDE_SLACK_MS ||
    optionStart > tripEnd + OUTSIDE_SLACK_MS
  );
}
