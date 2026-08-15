import { describe, expect, it } from "vitest";
import type { DashboardLine, TripDashboardView } from "@gtp/types";
import { costComposition } from "./costComposition";

/**
 * What a composition chart may claim about where the money went.
 *
 * The arithmetic here is trivial — sums and divisions. What is worth pinning is
 * every decision the model makes *on the reader's behalf*: which money is
 * comparable enough to sit in one ring, what a full circle means once the
 * target is passed, and when a named lane is worth more than a tidy one.
 */

function dashboard(over: Partial<TripDashboardView> = {}): TripDashboardView {
  return {
    tripId: "t1",
    defaultCurrency: "EUR",
    budgetPerPerson: null,
    memberCount: 4,
    committed: [],
    projected: [],
    viewerCommitted: [],
    lines: [],
    converted: null,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

let seq = 0;
function line(over: Partial<DashboardLine> = {}): DashboardLine {
  seq += 1;
  const perPerson = over.perPerson ?? 100;
  return {
    optionId: `opt-${seq}`,
    categoryId: "cat-stay",
    categoryName: "Stay",
    title: `Option ${seq}`,
    kind: "LOCKED",
    currency: "EUR",
    group: perPerson * 4,
    perPerson,
    effectiveHeadcount: 4,
    viewerOwes: true,
    converted: null,
    ...over,
  };
}

describe("what goes into the ring", () => {
  it("has nothing to draw before anything is locked and priced", () => {
    expect(costComposition(dashboard())).toBeNull();
  });

  it("sums a category's locked options into one slice", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({
            categoryId: "cat-do",
            categoryName: "Activities",
            perPerson: 5,
          }),
          line({
            categoryId: "cat-do",
            categoryName: "Activities",
            perPerson: 10,
          }),
          line({ categoryId: "cat-stay", categoryName: "Stay", perPerson: 50 }),
          line({
            categoryId: "cat-go",
            categoryName: "Transport",
            perPerson: 25,
          }),
        ],
      }),
    );
    // The owner's worked example: 100 all in, Activities 5 + 10 = 15%.
    expect(c?.charted).toBe(90);
    expect(c?.slices.map((s) => s.label)).toEqual([
      "Stay",
      "Transport",
      "Activities",
    ]);
    expect(c?.slices.find((s) => s.label === "Activities")?.amount).toBe(15);
  });

  it("ignores the front-runners, as the rest of the strip does", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 50 }),
          line({ kind: "FRONT_RUNNER", perPerson: 900, categoryId: "cat-go" }),
        ],
      }),
    );
    expect(c?.charted).toBe(50);
    expect(c?.slices).toHaveLength(1);
  });

  it("draws no wedge for an option that is locked but free", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 50 }),
          line({ categoryId: "cat-free", categoryName: "Free", perPerson: 0 }),
        ],
      }),
    );
    expect(c?.slices.map((s) => s.label)).toEqual(["Stay"]);
  });
});

describe("money everyone owes, and money only some do", () => {
  it("leaves out an option priced for part of the group, and names it", () => {
    const c = costComposition(
      dashboard({
        memberCount: 5,
        lines: [
          line({ perPerson: 50, effectiveHeadcount: 5 }),
          line({
            categoryId: "cat-go",
            categoryName: "Transport",
            title: "Airport taxi",
            perPerson: 10,
            effectiveHeadcount: 3,
          }),
        ],
      }),
    );
    // Ten euros three of five people owe is not comparable with fifty everyone
    // owes, and adding them makes a per-person total nobody pays.
    expect(c?.charted).toBe(50);
    expect(c?.slices.map((s) => s.label)).toEqual(["Stay"]);
    expect(c?.excluded).toEqual([
      {
        optionId: c!.excluded[0]!.optionId,
        title: "Airport taxi",
        categoryId: "cat-go",
        categoryName: "Transport",
        perPerson: 10,
        currency: "EUR",
        headcount: 3,
        // Carried through so the aside can mark the reader's own, which is the
        // arithmetic between what the ring charts and what the target says.
        viewerOwes: true,
      },
    ]);
  });

  it("carries whether the reader is one of the few who owe it", () => {
    const c = costComposition(
      dashboard({
        memberCount: 5,
        lines: [
          line({ perPerson: 50, effectiveHeadcount: 5 }),
          line({
            title: "Not mine",
            perPerson: 10,
            effectiveHeadcount: 3,
            viewerOwes: false,
          }),
        ],
      }),
    );
    expect(c?.excluded[0]?.viewerOwes).toBe(false);
  });

  it("charts a fixed headcount that still matches the group", () => {
    // Fixed at five with five members is shared by everyone; the fact that
    // somebody typed the number is not itself a reason to exclude it.
    const c = costComposition(
      dashboard({
        memberCount: 5,
        lines: [line({ perPerson: 50, effectiveHeadcount: 5 })],
      }),
    );
    expect(c?.charted).toBe(50);
    expect(c?.excluded).toEqual([]);
  });

  it("has nothing to draw when every locked option is for part of the group", () => {
    expect(
      costComposition(
        dashboard({
          memberCount: 5,
          lines: [line({ perPerson: 10, effectiveHeadcount: 2 })],
        }),
      ),
    ).toBeNull();
  });
});

describe("one unit, or an honest gap", () => {
  it("converts a foreign line into the trip's currency and says it is approximate", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 50 }),
          line({
            categoryId: "cat-go",
            categoryName: "Transport",
            currency: "HUF",
            perPerson: 20_000,
            converted: { group: 200, perPerson: 50 },
          }),
        ],
      }),
    );
    expect(c?.charted).toBe(100);
    expect(c?.approximate).toBe(true);
  });

  it("stays exact for a trip that never left its own currency", () => {
    // A same-currency line carries a converted pair too (it crosses at 1), and
    // reading that instead would stamp an approximation on a trip that has none.
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 50, converted: { group: 200, perPerson: 50 } }),
        ],
      }),
    );
    expect(c?.approximate).toBe(false);
  });

  it("names a currency no rate could reach rather than dropping it quietly", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 50 }),
          line({
            categoryId: "cat-go",
            categoryName: "Transport",
            currency: "RSD",
            perPerson: 3_000,
            converted: null,
          }),
        ],
      }),
    );
    expect(c?.charted).toBe(50);
    expect(c?.uncounted).toEqual(["RSD"]);
  });
});

describe("what a full circle means", () => {
  it("is the target while there is headroom left", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 200, lines: [line({ perPerson: 50 })] }),
    );
    expect(c?.full).toBe(200);
    expect(c?.slices[0]?.share).toBeCloseTo(0.25);
    expect(c?.overspend).toBe(0);
  });

  it("is the spend once the target is passed, and marks where it fell", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 100, lines: [line({ perPerson: 150 })] }),
    );
    expect(c?.full).toBe(150);
    expect(c?.overspend).toBe(50);
    expect(c?.overshare).toBeCloseTo(0.5);
    // Without this mark, fifty over and five thousand over are the same full
    // circle — the failure that retired the previous chart.
    expect(c?.targetMark).toBeCloseTo(100 / 150);
  });

  it("keeps the mark at the rim when the spend has only just reached the target", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 100, lines: [line({ perPerson: 100 })] }),
    );
    expect(c?.full).toBe(100);
    expect(c?.targetMark).toBe(1);
    expect(c?.overspend).toBe(0);
  });

  it("fills its own circle when there is no target to be a fraction of", () => {
    const c = costComposition(dashboard({ lines: [line({ perPerson: 50 })] }));
    expect(c?.full).toBe(50);
    expect(c?.targetMark).toBeNull();
    expect(c?.slices[0]?.share).toBe(1);
  });
});

describe("the tail", () => {
  const small = (n: number, amount: number) =>
    line({
      categoryId: `cat-${n}`,
      categoryName: `Lane ${n}`,
      perPerson: amount,
    });

  it("folds the rounding-error lanes together once there are two of them", () => {
    const c = costComposition(
      dashboard({
        lines: [
          line({ perPerson: 100 }),
          small(1, 2),
          small(2, 2),
          small(3, 1),
        ],
      }),
    );
    expect(c?.slices.map((s) => s.label)).toEqual(["Stay", "Other (3 lanes)"]);
    expect(c?.slices.at(-1)?.amount).toBe(5);
    expect(c?.slices.at(-1)?.categoryId).toBeNull();
  });

  it("leaves a lone small lane named, because a grey slice tells you less", () => {
    const c = costComposition(
      dashboard({ lines: [line({ perPerson: 100 }), small(1, 2)] }),
    );
    expect(c?.slices.map((s) => s.label)).toEqual(["Stay", "Lane 1"]);
  });

  it("measures smallness against the spend, so editing the budget cannot regroup lanes", () => {
    const lines = [line({ perPerson: 100 }), small(1, 2), small(2, 2)];
    const withoutTarget = costComposition(dashboard({ lines }));
    const withTarget = costComposition(
      dashboard({ lines, budgetPerPerson: 10_000 }),
    );
    expect(withTarget?.slices.map((s) => s.label)).toEqual(
      withoutTarget?.slices.map((s) => s.label),
    );
  });
});
