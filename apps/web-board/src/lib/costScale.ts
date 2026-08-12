/**
 * How a cost bar is scaled, with or without a spending target (post-launch).
 *
 * Until now the bar was always full: it normalised to its own projected total,
 * so a trip €300 under target and a trip €3,000 over drew exactly the same
 * picture. The bar said how the money *splits*, never how much of it there was
 * to spend. A target changes what the width can mean, in two directions:
 *
 * - **Under target** — the target is the full width, and the spend takes the
 *   fraction of it that it actually is. What is left is the room left, drawn as
 *   room rather than described in a sentence.
 * - **Over target** — the spend is the full width, because the picture has to
 *   fit what is being spent, and the target is marked where it falls inside it.
 *   The overshoot is then the distance from the mark to the end.
 *
 * The split between locked and front-runner money keeps its proportions
 * throughout: only the basis the two are measured against changes, never their
 * ratio to each other.
 *
 * Extracted as a pure function for the reason `timeline.ts` and `calendar.ts`
 * were: this is the part with the edge cases (a zero target is legal, and a
 * trip can have a target before anything is priced), and jsdom will not measure
 * the part that draws it.
 */

export type CostScale = {
  /** Width of the locked segment, as a percentage of the chart. */
  committedPct: number;
  /** Width of the front-runner segment, as a percentage of the chart. */
  extraPct: number;
  /**
   * Where the target falls, as a percentage, or `null` when nothing is marked.
   *
   * Only ever set when the spend has passed the target — under it the end of
   * the track *is* the target, and a mark there would say the same thing twice.
   */
  markerPct: number | null;
  /** True when the chart's full width is the target rather than the spend. */
  againstTarget: boolean;
};

const EMPTY: CostScale = {
  committedPct: 0,
  extraPct: 0,
  markerPct: null,
  againstTarget: false,
};

/**
 * Scale one currency's bar.
 *
 * All three figures must be in the **same unit** — the caller decides whether
 * that is group or per-person money, and a target only means anything beside
 * figures denominated the way it is (see `CostTally`).
 */
export function costScale({
  committed,
  projected,
  target,
}: {
  committed: number;
  projected: number;
  /** The spending target, or null/absent when the trip has none. */
  target?: number | null;
}): CostScale {
  // `projected` includes the locked money, so it is normally the larger of the
  // two. Taking the max anyway means a bad payload draws something honest
  // instead of a segment running off the end of its own track.
  const total = Math.max(projected, committed, 0);
  // A negative target is not a target. Zero is: "we mean to spend nothing" is
  // a real, if severe, position, and the schema allows it.
  const goal =
    target === null || target === undefined || target < 0 ? null : target;

  // Under (or exactly at) the target, the target is the width. Equality lands
  // here on purpose: a mark at the very end is a mark on the end cap.
  const againstTarget = goal !== null && total <= goal;
  const basis = againstTarget ? (goal as number) : total;
  if (basis <= 0) return EMPTY;

  const extra = Math.max(projected - committed, 0);
  return {
    committedPct: (Math.min(committed, total) / basis) * 100,
    extraPct: (extra / basis) * 100,
    markerPct: againstTarget || goal === null ? null : (goal / basis) * 100,
    againstTarget,
  };
}
