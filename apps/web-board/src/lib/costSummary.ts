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

/** How the locked spend stands against the trip's per-person target. */
export interface TargetVerdict {
  readonly target: number;
  readonly currency: string;
  /** Locked spend per person, in `currency`. */
  readonly spend: number;
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
  const target = d.budgetPerPerson;

  const all = locked.allIn;
  const usable = all !== null && all.currency === d.defaultCurrency;
  const spend = usable
    ? all.perPerson
    : (locked.parts.find((p) => p.currency === d.defaultCurrency)?.perPerson ??
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
    over,
    gap: over ? spend - target : target - spend,
    approximate: usable && all.approximate,
    uncounted,
  };
}
