import { useCallback, useState } from "react";
import type { CategoryView, OptionView } from "@gtp/types";

/** How the board orders its lanes. */
export type LaneSort = "manual" | "undecided";

const STORAGE_KEY = "gtp.board.laneSort";

/**
 * A category still needs a decision when it holds proposed cards but nothing
 * locked. Matches the home dashboard's `pendingDecisionCount`: an empty category
 * is *not* pending — there is nothing to decide yet — so it sorts with the
 * settled ones rather than shouting for attention it doesn't need.
 */
export function needsDecision(options: readonly OptionView[]): boolean {
  let proposed = false;
  for (const o of options) {
    if (o.status === "LOCKED") return false;
    proposed = true;
  }
  return proposed;
}

/**
 * Where a lane sits under `"undecided"` ordering — three tiers, not two:
 *
 * | rank | tier     | meaning                                              |
 * | ---- | -------- | ---------------------------------------------------- |
 * | 0    | pending  | proposed cards, nothing locked — this one needs you   |
 * | 1    | empty    | nothing proposed yet, so nothing to decide            |
 * | 2    | decided  | holds a locked option — settled, so it sorts **last** |
 *
 * The third tier is the point. Grouping merely by {@link needsDecision} put
 * *decided* and *empty* lanes in one bucket, so deciding a lane's option moved
 * it out of the front group but left it sitting among the empty lanes in
 * position order — not at the end of the row, which is where a settled lane
 * belongs once you are sorting by what still needs attention.
 *
 * A lane counts as decided on its **first** locked option: a multi-select
 * category may go on to lock several, and the first decision is the one that
 * settles it as far as this view is concerned.
 */
export function laneRank(options: readonly OptionView[]): 0 | 1 | 2 {
  if (options.some((o) => o.status === "LOCKED")) return 2;
  // Past the decided check, "needs a decision" is the only thing separating a
  // lane with proposals from an empty one — read it from the one definition.
  return needsDecision(options) ? 0 : 1;
}

/**
 * Order lanes for display. `"undecided"` floats the categories still awaiting a
 * decision to the front and sinks the decided ones to the back ({@link laneRank});
 * within each tier the caller's manual order is preserved, because
 * `Array.prototype.sort` is stable and the input arrives position-ordered from
 * the server.
 *
 * The manual order is never rewritten — this is a *view*, which is why it can be
 * a per-user preference rather than trip state. It is also why lane drag has to
 * be off while it is active: dragging reorders by index, and the indices the
 * user sees would not be the ones the server stores.
 */
export function sortLanes(
  categories: readonly CategoryView[],
  optionsByCategory: Record<string, OptionView[]>,
  sort: LaneSort,
): CategoryView[] {
  if (sort === "manual") return [...categories];
  return [...categories].sort(
    (a, b) =>
      laneRank(optionsByCategory[a.id] ?? []) -
      laneRank(optionsByCategory[b.id] ?? []),
  );
}

/**
 * The caller's lane-sort preference, persisted per browser. Deliberately local
 * rather than server state: it is one person's view of the board, not something
 * the trip agrees on, so it needs no contract and no write path.
 */
export function useLaneSort(): [LaneSort, (next: LaneSort) => void] {
  const [sort, setSortState] = useState<LaneSort>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "undecided"
        ? "undecided"
        : "manual";
    } catch {
      // Private mode / storage disabled — the default is a fine answer.
      return "manual";
    }
  });

  const setSort = useCallback((next: LaneSort) => {
    setSortState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload; not worth surfacing.
    }
  }, []);

  return [sort, setSort];
}
