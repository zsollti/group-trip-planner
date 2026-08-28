import type { DashboardSubtotal, TripDashboardView } from "@gtp/types";

/**
 * What the board can honestly say about a trip's cost in **one** figure.
 *
 * The cost surface used to draw a bar per currency, each split into locked
 * money and what the front-runners would add — four numbers per currency, times
 * up to three currencies, above a target that only spoke for one of them. Every
 * figure was defensible and the whole was unreadable, because it answered a
 * question nobody asks ("how is our Hungarian spend divided between decided and
 * likely?") instead of the one everyone does: **what have we committed to?**
 *
 * So the surface is now locked money only. The projection did not vanish from
 * the app — the cost engine still computes it and the front-runner logic still
 * exists — it stopped being *drawn*, because a bar whose bulk was hypothetical
 * made the part that is real hard to find.
 *
 * This module answers the one structural question that is left: is there a
 * single number that speaks for the whole trip, and how sure is it?
 */

/** One figure standing for everything locked, and how much to trust it. */
export interface AllInTotal {
  readonly group: number;
  readonly perPerson: number;
  readonly currency: string;
  /**
   * True when this came from converting other currencies into this one.
   *
   * The caller must mark it — `≈`, whole units, and the rates' date — because
   * an approximation that looks like a measurement is worse than no figure.
   */
  readonly approximate: boolean;
  /** Currencies left out for want of a rate. Empty on an exact figure. */
  readonly missing: readonly string[];
}

export interface LockedCost {
  /**
   * The exact locked subtotal per currency, always, in the payload's order.
   * These are the figures FR-27 guarantees: never summed across currencies,
   * never approximated. Whatever else this surface shows, it shows these.
   */
  readonly parts: readonly DashboardSubtotal[];
  /**
   * One figure for the lot, or null when there honestly isn't one — either
   * nothing is priced yet, or the trip spans currencies with no rates to cross.
   * Null is a normal state, not a failure: it is the app exactly as it was
   * before conversion existed.
   */
  readonly allIn: AllInTotal | null;
}

/**
 * Read the locked half of a cost dashboard.
 *
 * Three cases, in order of how much they can promise:
 *
 * 1. **One currency** — that subtotal *is* the total, exactly. Used even when
 *    rates are available and even when it is not the trip's own currency:
 *    converting a figure that needs no conversion trades an exact number for an
 *    approximate one and gains nothing.
 * 2. **Several, with rates** — the converted total, marked approximate, naming
 *    anything it could not fold in.
 * 3. **Several, without rates** — no single figure. The per-currency subtotals
 *    are all there is, and saying so is the honest answer; inventing a sum here
 *    is precisely what FR-27 forbids.
 */
export function lockedCost(d: TripDashboardView): LockedCost {
  // Priced-at-zero is not the same as unpriced: a currency only appears in the
  // payload once something in it has a price, so an empty list means nothing
  // has been decided and costed yet.
  const parts = d.committed;
  if (parts.length === 0) return { parts, allIn: null };

  const only = parts.length === 1 ? parts[0] : undefined;
  if (only) {
    return {
      parts,
      allIn: {
        group: only.group,
        perPerson: only.perPerson,
        currency: only.currency,
        approximate: false,
        missing: [],
      },
    };
  }

  const c = d.converted;
  if (!c) return { parts, allIn: null };
  return {
    parts,
    allIn: {
      group: c.committed.group,
      perPerson: c.committed.perPerson,
      currency: c.currency,
      approximate: true,
      // The projection's currency lists describe the whole picture, so they can
      // name a currency that only front-runners are priced in. Narrowed to the
      // ones actually contributing to the locked total, which is what this
      // figure is.
      missing: c.missing.filter((code) =>
        parts.some((p) => p.currency === code),
      ),
    },
  };
}

/**
 * The same read, narrowed to **what this member actually pays for**.
 *
 * `lockedCost` answers "what has the trip committed to". This answers "what
 * have I committed to", and the two differ the moment an option is priced for
 * part of the group: the trip's per-person total adds every option's per-head
 * cost, opt-in ones included, so a €4 thing four of five joined moves all five
 * people's figure — and tells the fifth they are €4 nearer a limit over money
 * they declined to spend.
 *
 * Same three cases as {@link lockedCost}, over the caller's own subtotals, so
 * the multi-currency story is identical: exact when there is one currency,
 * approximate when rates can cross them, and honestly absent when they cannot.
 */
export function viewerCost(d: TripDashboardView): LockedCost {
  const parts = d.viewerCommitted;
  if (parts.length === 0) return { parts, allIn: null };

  const only = parts.length === 1 ? parts[0] : undefined;
  if (only) {
    return {
      parts,
      allIn: {
        group: only.group,
        perPerson: only.perPerson,
        currency: only.currency,
        approximate: false,
        missing: [],
      },
    };
  }

  const v = d.converted?.viewer;
  if (!v) return { parts, allIn: null };
  return {
    parts,
    allIn: {
      group: v.group,
      perPerson: v.perPerson,
      currency: d.converted!.currency,
      approximate: true,
      missing: v.missing.filter((code) =>
        parts.some((p) => p.currency === code),
      ),
    },
  };
}

/**
 * What the reader is spending on **their own** things, as one figure.
 *
 * The same three-case honesty {@link viewerCost} follows: one currency is
 * exact, several need the server's crossing, and no crossing means no single
 * figure rather than a wrong one.
 *
 * `group` and `perPerson` carry the same number all the way through — the group
 * paying for a personal item is one person — so a caller may read either and
 * get the same answer.
 *
 * **This figure never reaches the target.** `targetVerdict` reads
 * `viewerCommitted` and only that. The trip's target is what the group budgeted
 * for the group's plan, and a member's own flight home is not something the
 * trip agreed to; counting it would tell someone they had overspent a budget
 * they are in fact keeping to. It is shown beside the verdict, never inside it.
 */
export function personalCost(d: TripDashboardView): LockedCost {
  const parts = d.viewerPersonal;
  if (parts.length === 0) return { parts, allIn: null };

  const only = parts.length === 1 ? parts[0] : undefined;
  if (only) {
    return {
      parts,
      allIn: {
        group: only.group,
        perPerson: only.perPerson,
        currency: only.currency,
        approximate: false,
        missing: [],
      },
    };
  }

  const p = d.converted?.personal;
  if (!p) return { parts, allIn: null };
  return {
    parts,
    allIn: {
      group: p.amount,
      perPerson: p.amount,
      currency: d.converted!.currency,
      approximate: true,
      missing: p.missing.filter((code) =>
        parts.some((part) => part.currency === code),
      ),
    },
  };
}

/**
 * The reader's real all-in: their share of the group's decisions **plus** their
 * own things.
 *
 * Null whenever either half cannot be stated as one figure, rather than
 * silently reporting the half that can — a total missing a currency it could
 * not cross is exactly the kind of figure this module exists to refuse.
 *
 * Both halves have to already be in the same currency. On a single-currency
 * trip they are, trivially; on a mixed one both come from the server's own
 * crossing into the trip's currency, so they agree by construction. The one
 * case left is a trip whose group spend is in one currency and whose reader
 * priced their flight in another, with no rates stored — and there the answer
 * is null, which is the truthful one.
 */
export function viewerAllIn(d: TripDashboardView): AllInTotal | null {
  const mine = viewerCost(d).allIn;
  const own = personalCost(d).allIn;
  // Nothing of one's own is not a missing figure — it is a zero, and the
  // reader's all-in is then simply their share.
  if (own === null) return d.viewerPersonal.length === 0 ? mine : null;
  if (mine === null) return d.viewerCommitted.length === 0 ? own : null;
  if (mine.currency !== own.currency) return null;
  return {
    group: mine.group + own.group,
    perPerson: mine.perPerson + own.perPerson,
    currency: mine.currency,
    approximate: mine.approximate || own.approximate,
    missing: [...new Set([...mine.missing, ...own.missing])],
  };
}

/**
 * Whose money a figure on the cost surface is made of.
 *
 * `group` is what the trip spends and reads the same for everybody; `viewer` is
 * one person's share of that plus the things only they are paying for, and no
 * two readers see the same one.
 *
 * It lives here rather than on the chart model because it is a fact about the
 * *money*, and the chart, the headline caption and the target sentence all have
 * to agree about it. Three surfaces inferring it separately is three chances to
 * label a figure as something it is not.
 */
export type CostUnit = "group" | "viewer";

/** How the locked spend stands against a target, in one unit or the other. */
export interface TargetVerdict {
  readonly target: number;
  readonly currency: string;
  /** Locked spend in `currency`, denominated per {@link TargetVerdict.unit}. */
  readonly spend: number;
  /** Which money this is: the trip's, or the reader's own. */
  readonly unit: CostUnit;
  /**
   * The per-person figure a `group` target was scaled from, and null on a
   * `viewer` one, where the target *is* that figure.
   *
   * Carried so the surface can bridge the two for the person who authored it:
   * an organizer who typed 500 and is shown 3,000 needs to be able to see why
   * without opening the edit dialog to check.
   */
  readonly basis: number | null;
  readonly over: boolean;
  /** The distance either way — never negative. */
  readonly gap: number;
  readonly approximate: boolean;
  /** Currencies this verdict does not account for. */
  readonly uncounted: readonly string[];
}

/**
 * Compare a locked spend to the target, or return null when there is nothing to
 * compare.
 *
 * **Fed the caller's own cost** ({@link viewerCost}), not the trip's. A target
 * denominated per person is a statement about one person's money, and reading
 * it against a total that includes options they are not part of warns the wrong
 * people — which is exactly what it did.
 *
 * The target is per person and denominated in the trip's own currency, so the
 * comparison has to be made in that unit — **and per-person money is not the
 * group total over the member count**, because an opt-in option is divided by
 * the people who joined it rather than by the trip. The engine already did that division; this only picks
 * which of its answers applies.
 *
 * When the all-in figure is in the trip's currency it wins, and the verdict
 * inherits its approximation — an `≈` on a judgement matters more than on a
 * number, because the judgement is what someone acts on. Otherwise the verdict
 * falls back to the trip-currency subtotal alone and names what it is leaving
 * out, rather than implying the rest is covered.
 */
export function targetVerdict(
  d: TripDashboardView,
  locked: LockedCost,
): TargetVerdict | null {
  if (d.budgetPerPerson === null) return null;
  return verdict(d, locked, d.budgetPerPerson, "viewer", null);
}

/**
 * The same comparison for **the trip**: what everyone is spending together,
 * against what the group set out to spend together.
 *
 * The organizer still authors one number and it is still per person. This
 * multiplies it by the member count, because the sentence sits under a ring
 * drawn in group money and a target in a different unit from the chart above it
 * is how the two came to describe different trips.
 *
 * Null without a member count as well as without a budget: `target × 0` is
 * zero, and a zero target puts every trip that has spent anything infinitely
 * over — which is a statement about an empty trip, not about the money.
 */
export function groupTargetVerdict(d: TripDashboardView): TargetVerdict | null {
  if (d.budgetPerPerson === null || d.memberCount <= 0) return null;
  return verdict(
    d,
    lockedCost(d),
    d.budgetPerPerson * d.memberCount,
    "group",
    d.budgetPerPerson,
  );
}

/**
 * The comparison both verdicts are, once the target and the unit are settled.
 *
 * Shared rather than written twice because the multi-currency rule below is the
 * subtle part, and two copies of it would drift the first time one of them was
 * corrected.
 */
function verdict(
  d: TripDashboardView,
  locked: LockedCost,
  target: number,
  unit: CostUnit,
  basis: number | null,
): TargetVerdict {
  const field = unit === "group" ? "group" : "perPerson";
  const all = locked.allIn;
  const usable = all !== null && all.currency === d.defaultCurrency;
  const spend = usable
    ? all[field]
    : (locked.parts.find((p) => p.currency === d.defaultCurrency)?.[field] ??
      0);

  // What the verdict does not cover. With a usable all-in figure that is only
  // whatever had no rate; without one it is every other currency on the trip.
  const uncounted = usable
    ? all.missing
    : locked.parts
        .filter((p) => p.currency !== d.defaultCurrency)
        .map((p) => p.currency);

  const over = spend > target;
  return {
    target,
    currency: d.defaultCurrency,
    spend,
    unit,
    basis,
    over,
    gap: over ? spend - target : target - spend,
    approximate: usable && all.approximate,
    uncounted,
  };
}
