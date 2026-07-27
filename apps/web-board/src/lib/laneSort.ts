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
 * Order lanes for display. `"undecided"` floats the categories still awaiting a
 * decision to the front; within each group the caller's manual order is
 * preserved, because `Array.prototype.sort` is stable and the input arrives
 * position-ordered from the server.
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
  return [...categories].sort((a, b) => {
    const aPending = needsDecision(optionsByCategory[a.id] ?? []);
    const bPending = needsDecision(optionsByCategory[b.id] ?? []);
    if (aPending === bPending) return 0;
    return aPending ? -1 : 1;
  });
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
