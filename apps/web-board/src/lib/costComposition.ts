import type { DashboardLine, TripDashboardView } from "@gtp/types";

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
 * 1. **Per person, because that is what the target is in.** A chart measured
 *    against a per-person budget has to be denominated in per-person money or
 *    the ring and the sentence under it describe different trips.
 * 2. **An option priced for part of the group is left out of the chart and
 *    named beneath it.** See {@link isSharedByEveryone}.
 * 3. **The parts are drawn proportionally and the headline comes from the
 *    totals.** Converted lines can sum to a hair off the converted total (the
 *    payload converts subtotals for its totals and lines for its parts), so
 *    re-adding these to produce the trip's headline figure would occasionally
 *    print a number a cent away from the one beside it.
 */

/** A lane's share of the circle. `categoryId` is null for the folded tail. */
export interface CostSlice {
  readonly categoryId: string | null;
  readonly label: string;
  /** Per-person money, in the composition's currency. */
  readonly amount: number;
  /** Fraction of the whole circle — of `full`, not of `charted`. */
  readonly share: number;
}

/**
 * A locked option the chart deliberately does not draw, kept so the surface can
 * say so. Its per-person figure is real money someone owes; it is simply not
 * money *everyone* owes, which is the only thing the ring can be made of.
 */
export interface ExcludedCost {
  readonly optionId: string;
  readonly title: string;
  readonly categoryId: string;
  readonly categoryName: string;
  /** Per-person, in this option's own currency — never converted. */
  readonly perPerson: number;
  readonly currency: string;
  /** How many people it was priced for. */
  readonly headcount: number;
}

export interface CostComposition {
  readonly currency: string;
  /** True when any drawn part had to be converted to get here. */
  readonly approximate: boolean;
  /** Lanes in descending size, the folded tail last. */
  readonly slices: readonly CostSlice[];
  /** Per-person locked money the chart actually draws. */
  readonly charted: number;
  readonly target: number | null;
  /**
   * What a full circle means: the target when there is headroom left, the spend
   * once it is exceeded. One rule covering both — under target the remainder is
   * headroom, over it the whole ring is spend and the target sits inside.
   */
  readonly full: number;
  /** How far past the target, and by what fraction of it. Zero when under. */
  readonly overspend: number;
  readonly overshare: number;
  /** Where the target falls on the ring, 0–1. Null when there is no target. */
  readonly targetMark: number | null;
  /** Locked options priced for part of the group, named rather than drawn. */
  readonly excluded: readonly ExcludedCost[];
  /** Currencies no rate could reach, so nothing here accounts for them. */
  readonly uncounted: readonly string[];
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
 * Is this option's cost shared by everyone the chart speaks for?
 *
 * A per-person figure only means something next to another per-person figure
 * when both are divided by the same people. Three of five sharing a €30 taxi
 * costs those three €10 each; adding that €10 to an accommodation share
 * computed across five produces a per-person total that **nobody actually
 * pays** — and it would then be compared against a target that is per person
 * across the whole group.
 *
 * A whole-group option always resolves to the live member count, so this single
 * comparison covers both cases the rule cares about: a whole-group option is
 * always shared, and an opt-in one counts as shared exactly when everybody has
 * joined it. That is why nothing on the wire needs to name the participation
 * mode here — the resolved number already tells us, and it kept being the right
 * test when the model underneath it changed completely.
 */
function isSharedByEveryone(line: DashboardLine, memberCount: number): boolean {
  return line.effectiveHeadcount === memberCount;
}

/** This line's per-person money in the trip's currency, or null if unreachable. */
function perPersonInTripCurrency(
  line: DashboardLine,
  defaultCurrency: string,
): { amount: number; converted: boolean } | null {
  // An exact figure beats an approximate one that would round to it. A line
  // already in the trip's currency also has a `converted` pair (it crosses at
  // 1), and taking that instead would mark the whole composition approximate
  // for a trip that never left its own currency.
  if (line.currency === defaultCurrency) {
    return { amount: line.perPerson, converted: false };
  }
  if (line.converted === null) return null;
  return { amount: line.converted.perPerson, converted: true };
}

/**
 * Build the composition, or null when there is nothing a chart could say.
 *
 * Null covers three honest cases: nothing locked and priced yet, every locked
 * option priced for part of the group, and no rate able to reach the trip's own
 * currency. In each the caller falls back to the figures it already prints.
 */
export function costComposition(d: TripDashboardView): CostComposition | null {
  const byCategory = new Map<string, { label: string; amount: number }>();
  const excluded: ExcludedCost[] = [];
  const uncounted = new Set<string>();
  let charted = 0;
  let approximate = false;

  for (const line of d.lines) {
    if (line.kind !== "LOCKED") continue;

    if (!isSharedByEveryone(line, d.memberCount)) {
      // Named in its own currency, because that is the price someone was
      // actually quoted, and this line is a statement about one option rather
      // than a part of a sum.
      excluded.push({
        optionId: line.optionId,
        title: line.title,
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        perPerson: line.perPerson,
        currency: line.currency,
        headcount: line.effectiveHeadcount,
      });
      continue;
    }

    const money = perPersonInTripCurrency(line, d.defaultCurrency);
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

  const target = d.budgetPerPerson;
  if (charted <= 0) return null;

  const full = target !== null && target > charted ? target : charted;
  const overspend = target !== null && charted > target ? charted - target : 0;

  const ranked = [...byCategory.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  return {
    currency: d.defaultCurrency,
    approximate,
    slices: withTail(ranked, charted, full),
    charted,
    target,
    full,
    overspend,
    overshare: target !== null && target > 0 ? overspend / target : 0,
    // Under the target the mark is where it sits ahead of the spend; at or over
    // it the ring *is* the spend, and the mark lands inside it — which is the
    // whole reason to draw one. Without it €5 over and €5,000 over are the same
    // full circle, which is the failure that retired the previous chart.
    targetMark:
      target !== null && target > 0 ? Math.min(target / full, 1) : null,
    excluded,
    uncounted: [...uncounted],
  };
}

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
  ranked: readonly { categoryId: string; label: string; amount: number }[],
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
