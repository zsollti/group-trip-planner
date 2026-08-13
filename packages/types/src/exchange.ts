/**
 * Approximate currency conversion (post-launch) — the pure core.
 *
 * FR-27 says the dashboard groups money **per currency and never converts**, and
 * that stays true: everything here is *additional*. The per-currency subtotals
 * remain the exact figures they always were, and a conversion is offered beside
 * them as what it is — an approximation, from one daily snapshot, of what the
 * trip roughly comes to in one currency. Nothing here ever rewrites a stored
 * amount: an option keeps the currency it was priced in forever, and this runs
 * on read.
 *
 * **EUR is the pivot, not the destination.** Rates are stored as "units per one
 * EUR" because that is how the reference source publishes them, but a trip is
 * converted into *its own* default currency by crossing two of them. A trip that
 * thinks in forints gets forints.
 *
 * No Prisma, no clock, no fetch — the same rule the cost engine follows, for the
 * same reason: this is where the arithmetic can be tested exhaustively, and the
 * IO around it (which is the part that fails) is somebody else's problem.
 *
 * Money is left unrounded, exactly as {@link ./cost.js} leaves it. Rounding and
 * formatting are the front-end's job, and an approximate figure has its own
 * display rule there — whole units, no cents, since cents on a converted total
 * claim a precision the rate does not have.
 */

/** The currency every stored rate is quoted against. */
export const RATE_PIVOT = "EUR";

/**
 * Rates as "how many of this currency one {@link RATE_PIVOT} buys".
 *
 * The pivot itself may be absent; it is 1 by definition and never stored.
 */
export type RateTable = Readonly<Record<string, number>>;

/** A currency subtotal, as the cost engine produces them. */
interface Subtotal {
  readonly currency: string;
  readonly group: number;
  readonly perPerson: number;
}

/** What a conversion of several subtotals came to, and what it had to leave out. */
export interface ConvertedTotals {
  readonly group: number;
  readonly perPerson: number;
  /** Currencies folded into the total, in the order given. */
  readonly converted: readonly string[];
  /**
   * Currencies left out because no rate was known for them.
   *
   * This is a **normal state, not an error**: the reference source publishes
   * around thirty currencies and the picker offers sixty-three, so a trip
   * priced in Serbian dinar has no rate and must be *said* to have none rather
   * than quietly dropped out of a total that then looks complete.
   */
  readonly missing: readonly string[];
}

/** One currency in terms of another, or null when either rate is unknown. */
export function crossRate(
  from: string,
  to: string,
  rates: RateTable,
): number | null {
  if (from === to) return 1;
  const fromPer = from === RATE_PIVOT ? 1 : rates[from];
  const toPer = to === RATE_PIVOT ? 1 : rates[to];
  if (!isUsableRate(fromPer) || !isUsableRate(toPer)) return null;
  // Both are "units per pivot", so the pivot cancels: 1 from = (1/fromPer)
  // pivots = toPer/fromPer to.
  return toPer / fromPer;
}

/** Convert one amount, or null when the pair cannot be crossed. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: RateTable,
): number | null {
  const rate = crossRate(from, to, rates);
  return rate === null ? null : amount * rate;
}

/**
 * Fold per-currency subtotals into one approximate total.
 *
 * Returns `null` when the *destination* has no rate, because then nothing can
 * be crossed into it and there is no total to offer — as opposed to a total
 * that is merely incomplete, which is reported through `missing`.
 *
 * The subtotals are converted, never the individual options: they are already
 * exact sums, and one multiplication per currency introduces less error than
 * one per line.
 */
export function convertSubtotals(
  subtotals: readonly Subtotal[],
  to: string,
  rates: RateTable,
): ConvertedTotals | null {
  if (to !== RATE_PIVOT && !isUsableRate(rates[to])) return null;

  let group = 0;
  let perPerson = 0;
  const converted: string[] = [];
  const missing: string[] = [];

  for (const subtotal of subtotals) {
    const rate = crossRate(subtotal.currency, to, rates);
    if (rate === null) {
      missing.push(subtotal.currency);
      continue;
    }
    group += subtotal.group * rate;
    perPerson += subtotal.perPerson * rate;
    converted.push(subtotal.currency);
  }

  return { group, perPerson, converted, missing };
}

/**
 * A rate has to be a positive, finite number to be usable.
 *
 * Zero is the dangerous one: it passes a `!= null` check and then converts
 * every amount in that currency to nothing, which reads as "this costs
 * nothing" rather than "this could not be converted". Anything unusable is
 * treated as a missing rate, which is a state the caller already handles.
 */
function isUsableRate(rate: number | undefined): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}
