import type { DashboardLine, TripDashboardView } from "@gtp/types";
import type { CostUnit } from "./costSummary";

/**
 * Where the trip's locked money went, as one set of comparable parts.
 *
 * The cost strip answers *how much* and *how it stands against the target*. It
 * has never answered **where the money went**, and no rearrangement of the
 * figures it already has can: the totals are per currency, and the target is a
 * single number. This module builds the missing model — one amount per
 * category, all in one unit, each a share of one circle — and both charts draw
 * from it, so a donut and a bar of the same trip can never disagree.
 *
 * Three rules shape it, and each is a judgement, not arithmetic:
 *
 * 1. **Each chart picks one unit and every part of it is in that unit.** The
 *    trip's chart is in **group** money and the reader's own is in **their**
 *    money. That is the whole difference between them, and it is what lets each
 *    hold every option that belongs to it.
 *
 *    It used to be per person on both, which forced a rule that an option
 *    priced for part of the group could not be drawn at all: three of five
 *    sharing a €30 taxi owe €10 each, and adding that €10 to an accommodation
 *    share divided by five produces a per-person total nobody actually pays.
 *    The exclusion was correct given the unit, and the unit was the mistake. In
 *    group money that taxi is simply €30 the trip spends, and in one reader's
 *    money it is €10 they owe or nothing at all. Neither needs an exception.
 * 2. **A target is drawn in the unit of the chart it is on.** The organizer
 *    authors one per-person figure; the trip's ring multiplies it by the
 *    member count so the mark and the wedges measure the same thing. The
 *    reader's own ring uses the reader's own budget, and has none without one.
 * 3. **The parts are drawn proportionally and the headline comes from the
 *    totals.** Converted lines can sum to a hair off the converted total (the
 *    payload converts subtotals for its totals and lines for its parts), so
 *    re-adding these to produce the trip's headline figure would occasionally
 *    print a number a cent away from the one beside it.
 */

/**
 * A lane's share of the circle. `categoryId` is null for the folded tail.
 *
 * A slice is a lane, an amount and a fraction — and no longer the list of
 * decisions behind it. It carried one (`parts`), drawn in the middle of the
 * ring on hover, and the hole turned out to be the wrong place for it: a stack
 * of option titles at 0.56rem, appearing and vanishing under the pointer. The
 * board itself is where those decisions are read.
 */
export interface CostSlice {
  readonly categoryId: string | null;
  readonly label: string;
  /** Money in the composition's currency, and in its unit. */
  readonly amount: number;
  /** Fraction of the whole circle — of `full`, not of `charted`. */
  readonly share: number;
}

export interface CostComposition {
  readonly currency: string;
  /**
   * Whose money this is, and therefore what every figure on it means.
   *
   * Carried on the model rather than inferred by each surface, because the
   * caption under the headline, the wording of the target line and the unit of
   * every wedge all depend on it, and three components deciding it separately
   * is three chances for a chart to be labelled as something it is not.
   */
  readonly unit: CostUnit;
  /** True when any drawn part had to be converted to get here. */
  readonly approximate: boolean;
  /** Lanes in descending size, the folded tail last. */
  readonly slices: readonly CostSlice[];
  /** Locked money the chart actually draws, in this composition's unit. */
  readonly charted: number;
  readonly target: number | null;
  /**
   * What a full circle means: the target when there is headroom left, the spend
   * once it is exceeded. One rule covering both — under target the remainder is
   * headroom, over it the whole ring is spend and the target sits inside.
   */
  readonly full: number;
  /**
   * Money still inside the target — what the grey remainder of the ring is
   * worth. Zero once the target is met or there is no target at all.
   *
   * Derived rather than left to each chart, because it is the one figure on
   * this surface that a reader has to do arithmetic to get otherwise ("what is
   * the grey bit?"), and two charts computing it from `full - charted`
   * independently is two chances to disagree with the wedges beside it.
   */
  readonly remaining: number;
  /** How far past the target, and by what fraction of it. Zero when under. */
  readonly overspend: number;
  readonly overshare: number;
  /** Where the target falls on the ring, 0–1. Null when there is no target. */
  readonly targetMark: number | null;
  /** Currencies no rate could reach, so nothing here accounts for them. */
  readonly uncounted: readonly string[];
}

/**
 * The keys the ring and the list agree on for "which part is being read".
 *
 * A category id is the obvious key and covers most parts, but two of them have
 * no category: the folded tail, and the remainder inside the target. Both are
 * real parts of the circle a reader can point at, so both need a name, and the
 * two surfaces must use the *same* name or hovering the ring would light a
 * different row than hovering the row lights on the ring.
 */
export const TAIL_KEY = "tail";
export const REMAINING_KEY = "remaining";
/**
 * The overshoot, which is not a part of the circle but is a part of the drawing.
 *
 * It earns a key for the same reason the other two did: it is a mark a reader
 * can point at, and pointing at it must light the same thing on the ring and in
 * the list. That it measures *across* the wedges rather than being one of them
 * is a fact about the arithmetic, not about whether it can be read.
 */
export const OVER_KEY = "over";

/** The key for one drawn slice. */
export function sliceKey(slice: CostSlice): string {
  return slice.categoryId ?? TAIL_KEY;
}

/**
 * Anything below this share of the spend joins the tail.
 *
 * Measured against the **spend**, not the circle, so editing the budget never
 * silently regroups the lanes — the answer to "is this lane a rounding error?"
 * is about the money, and should not change because someone raised their
 * target.
 */
const TAIL_SHARE = 0.05;

/**
 * This line's money in the trip's currency, in one of its two units, or null if
 * no rate reaches it.
 *
 * `field` names the unit rather than the caller reading the pair itself,
 * because the exact-beats-converted rule below has to apply identically to
 * both — and it did not, back when the group figure had no reader and only the
 * per-person one was ever taken.
 */
function inTripCurrency(
  line: DashboardLine,
  defaultCurrency: string,
  field: "group" | "perPerson",
): { amount: number; converted: boolean } | null {
  // An exact figure beats an approximate one that would round to it. A line
  // already in the trip's currency also has a `converted` pair (it crosses at
  // 1), and taking that instead would mark the whole composition approximate
  // for a trip that never left its own currency.
  if (line.currency === defaultCurrency) {
    return { amount: line[field], converted: false };
  }
  if (line.converted === null) return null;
  return { amount: line.converted[field], converted: true };
}

/**
 * Build the trip's composition, or null when there is nothing a chart could say.
 *
 * **In group money**, so it holds every locked option the trip has decided on,
 * including the ones only some members are paying into. Those are money the
 * trip spends whoever chips in, and leaving them out gave the organizer a
 * picture of the trip's cost that was systematically too low.
 *
 * Null covers two honest cases now: nothing locked and priced yet, and no rate
 * able to reach the trip's own currency. ("Every option priced for part of the
 * group" was a third, and is not a case any more.) In each the caller falls
 * back to the figures it already prints.
 */
export function costComposition(d: TripDashboardView): CostComposition | null {
  const byCategory = new Map<string, { label: string; amount: number }>();
  const uncounted = new Set<string>();
  let charted = 0;
  let approximate = false;

  for (const line of d.lines) {
    if (line.kind !== "LOCKED") continue;

    const money = inTripCurrency(line, d.defaultCurrency, "group");
    if (money === null) {
      uncounted.add(line.currency);
      continue;
    }
    if (money.converted) approximate = true;
    // A locked option priced at zero is free, not missing. It counts as
    // decided and draws no wedge.
    if (money.amount <= 0) continue;

    charted += money.amount;
    const acc = byCategory.get(line.categoryId);
    if (acc) acc.amount += money.amount;
    else
      byCategory.set(line.categoryId, {
        label: line.categoryName,
        amount: money.amount,
      });
  }

  // The organizer authors one per-person figure; this chart is in group money,
  // so the target it draws is that figure times the people it is per. Stated
  // here rather than on the wire because it is a *drawing* decision — the trip
  // still has exactly one budget, and a second one on the payload would be a
  // number nobody typed.
  //
  // A trip with no members has no group target rather than a target of zero,
  // which would draw everyone infinitely over.
  const target =
    d.budgetPerPerson !== null && d.memberCount > 0
      ? d.budgetPerPerson * d.memberCount
      : null;
  if (charted <= 0) return null;

  const full = target !== null && target > charted ? target : charted;
  const overspend = target !== null && charted > target ? charted - target : 0;

  const ranked = [...byCategory.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  return {
    currency: d.defaultCurrency,
    unit: "group",
    approximate,
    slices: withTail(ranked, charted, full),
    charted,
    target,
    full,
    // `full - charted` and never negative: over the target the ring is all
    // spend and there is no remainder to name.
    remaining: Math.max(full - charted, 0),
    overspend,
    overshare: target !== null && target > 0 ? overspend / target : 0,
    // Under the target the mark is where it sits ahead of the spend; at or over
    // it the ring *is* the spend, and the mark lands inside it — which is the
    // whole reason to draw one. Without it €5 over and €5,000 over are the same
    // full circle, which is the failure that retired the previous chart.
    targetMark:
      target !== null && target > 0 ? Math.min(target / full, 1) : null,
    uncounted: [...uncounted],
  };
}

/**
 * The same picture, drawn for **one reader**: their share of the group's
 * decisions plus the things only they are paying for.
 *
 * A sibling of {@link costComposition} rather than a mode of it, so each is
 * provably about one kind of money. The two differ in exactly two ways, and
 * both follow from whose money is being drawn:
 *
 * 1. **Only lines this reader owes**, at their per-head price. The trip's ring
 *    adds every locked option's whole cost; this one takes `viewerOwes` alone
 *    and takes what that reader's share of it is.
 * 2. **Their own things are in it.** Personal items are nobody else's business
 *    and are no part of the trip's chart at all; here they are simply money the
 *    reader is spending on this trip, which is the question this ring answers.
 *
 * There is **no target yet** — that arrives with the reader's own budget in a
 * later slice, and until then the full circle is the whole of what they spend.
 * The trip's per-person figure is deliberately not borrowed for it: personal
 * money read against the group's target would draw someone over a line the
 * sentence beneath says they are keeping to.
 *
 * Personal items are grouped by their **tag** where they carry one, so they
 * land in the same wedge as the lane they belong with. Untagged ones gather
 * under one unnamed lane rather than each becoming a wedge of their own: they
 * have nothing in common except being untagged, and a ring of one-item slices
 * is a list drawn as a circle.
 */
export function myCostComposition(
  d: TripDashboardView,
  /** Label for the untagged group — passed in so this module says no words. */
  untaggedLabel: string,
): CostComposition | null {
  const byCategory = new Map<string, { label: string; amount: number }>();
  const uncounted = new Set<string>();
  let charted = 0;
  let approximate = false;

  const add = (key: string, label: string, amount: number) => {
    charted += amount;
    const acc = byCategory.get(key);
    if (acc) acc.amount += amount;
    else byCategory.set(key, { label, amount });
  };

  for (const line of d.lines) {
    if (line.kind !== "LOCKED" || !line.viewerOwes) continue;
    const money = inTripCurrency(line, d.defaultCurrency, "perPerson");
    if (money === null) {
      uncounted.add(line.currency);
      continue;
    }
    if (money.converted) approximate = true;
    if (money.amount <= 0) continue;
    add(line.categoryId, line.categoryName, money.amount);
  }

  for (const item of d.personalLines) {
    const exact = item.currency === d.defaultCurrency;
    const amount = exact ? item.amount : item.converted;
    if (amount === null) {
      uncounted.add(item.currency);
      continue;
    }
    if (!exact) approximate = true;
    if (amount <= 0) continue;
    // Tagged items join their lane's wedge; the rest share one. `PERSONAL_KEY`
    // is not a category id, and the null `categoryId` on its slice is what
    // tells the chart to paint it with no hue — the same signal the folded
    // tail uses.
    add(
      item.categoryId ?? PERSONAL_KEY,
      item.categoryName ?? untaggedLabel,
      amount,
    );
  }

  if (charted <= 0) return null;

  const ranked = [...byCategory.entries()]
    .map(([categoryId, v]) => ({
      // Null is already the chart's word for "no lane, so no hue" — it is what
      // the folded tail carries. The untagged bucket wants the same treatment
      // and says the same thing, rather than a third value to be taught.
      categoryId: categoryId === PERSONAL_KEY ? null : categoryId,
      ...v,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  return {
    currency: d.defaultCurrency,
    unit: "viewer",
    approximate,
    slices: withTail(ranked, charted, charted),
    charted,
    // No target, and therefore no mark, no remainder and no overspend: this
    // ring is the whole of what the reader spends, and every one of those
    // fields is an answer to a question it is not being asked.
    target: null,
    full: charted,
    remaining: 0,
    overspend: 0,
    overshare: 0,
    targetMark: null,
    uncounted: [...uncounted],
  };
}

/** The bucket untagged personal items share. Never a real category id. */
const PERSONAL_KEY = "\u0000personal";

/**
 * Fold the rounding-error lanes into one tail, but only when folding is a
 * kindness.
 *
 * Collapsing a *single* small lane trades a named colour for an anonymous grey
 * one and tells the reader strictly less, so the tail forms only when at least
 * two lanes would join it. That also keeps the common trip — four lanes, one of
 * them small — reading as itself.
 */
function withTail(
  ranked: readonly {
    // Nullable because a group can legitimately have no lane behind it: the
    // reader's untagged personal items are one wedge with no hue to borrow.
    categoryId: string | null;
    label: string;
    amount: number;
  }[],
  charted: number,
  full: number,
): CostSlice[] {
  const small = ranked.filter((s) => s.amount / charted < TAIL_SHARE);
  const keep =
    small.length >= 2 ? ranked.filter((s) => !small.includes(s)) : ranked;
  const slices: CostSlice[] = keep.map((s) => ({
    categoryId: s.categoryId,
    label: s.label,
    amount: s.amount,
    share: s.amount / full,
  }));

  if (small.length >= 2) {
    const amount = small.reduce((sum, s) => sum + s.amount, 0);
    slices.push({
      categoryId: null,
      label: `Other (${small.length} lanes)`,
      amount,
      share: amount / full,
    });
  }
  return slices;
}
