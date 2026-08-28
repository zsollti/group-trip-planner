import type { TripDashboardView } from "@gtp/types";

/**
 * An empty cost dashboard, **typed**, for the tests that only need the board to
 * render.
 *
 * It exists because of a bug class rather than for convenience. Several test
 * files answer `/dashboard` from an object literal inside a `vi.fn` stub, and a
 * `fetch` stub returns `Response`, so **nothing typechecks those literals
 * against `TripDashboardView`**. A field added to the contract therefore does
 * not fail the build — it arrives at the component as `undefined` and surfaces,
 * if at all, as a runtime error inside whichever branch first reads it. That is
 * exactly what happened when `personalLines` landed, and again with
 * `viewerBudget`.
 *
 * Going through this function puts the literal in a typed position, so the next
 * required field is a compile error in one place instead of a silent
 * `undefined` in four. Anything a case actually cares about is passed in
 * `over`; everything else is the honest empty value.
 *
 * Deliberately **not** a `Partial` cast. A cast would restore precisely the
 * hole this closes.
 */
export function emptyDashboard(
  over: Partial<TripDashboardView> = {},
): TripDashboardView {
  return {
    tripId: "t1",
    defaultCurrency: "EUR",
    budgetPerPerson: null,
    viewerBudget: null,
    memberCount: 1,
    committed: [],
    projected: [],
    viewerCommitted: [],
    viewerPersonal: [],
    lines: [],
    personalLines: [],
    converted: null,
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}
