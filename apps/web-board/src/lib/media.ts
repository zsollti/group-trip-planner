import { useEffect, useState } from "react";

/**
 * Whether a media query currently matches, kept in sync as the window changes.
 *
 * Used to pick a *layout*, not to hide things — the two timeline layouts are
 * different components with different DOM, so this cannot be a CSS breakpoint
 * without mounting both and paying for both.
 *
 * **Defaults to `false` when `matchMedia` is missing**, which is jsdom. That is
 * deliberate and it is the safe default in both directions: the tests get the
 * narrow layout, which is the one that works everywhere, and a server or test
 * environment never renders a wide grid it cannot measure.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // Re-read on subscribe: the query can have changed between the initial
    // state and this effect (a resize during hydration, or a changed `query`).
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Wide enough for a week of day columns.
 *
 * 64rem is where seven columns still clear ~110px each inside the page's
 * measure — below that a calendar grid stops being a calendar and becomes a
 * smear, which is the argument the vertical spine was built on and is still
 * right at that size.
 */
export const CALENDAR_MIN_WIDTH = "(min-width: 64rem)";
