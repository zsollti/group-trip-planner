import { useCallback, useState } from "react";

/**
 * Which shape the cost composition is drawn in.
 *
 * Two forms of the same model, and the choice is genuinely a matter of taste:
 * a ring makes the parts feel like a whole, while a bar makes them easier to
 * *compare*, because a length is easier to judge than an angle. Rather than
 * decide that for everyone, both ship and the reader picks.
 */
export type CostChartForm = "donut" | "bar";

const STORAGE_KEY = "gtp.board.costChart";

/**
 * The caller's chart preference, persisted per browser.
 *
 * Local, like the lane sort and for the same reason: it is one person's view of
 * one surface, not something the trip has to agree on, so it needs no contract,
 * no write path and no round trip. Two people looking at the same board may
 * quite reasonably want different pictures of it.
 */
export function useCostChartForm(): [
  CostChartForm,
  (next: CostChartForm) => void,
] {
  const [form, setFormState] = useState<CostChartForm>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "bar"
        ? "bar"
        : "donut";
    } catch {
      // Private mode / storage disabled — the default is a fine answer.
      return "donut";
    }
  });

  const setForm = useCallback((next: CostChartForm) => {
    setFormState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload; not worth surfacing.
    }
  }, []);

  return [form, setForm];
}
