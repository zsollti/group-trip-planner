import { describe, expect, it } from "vitest";
import type { DashboardLine, TripDashboardView } from "@gtp/types";
import { costComposition, myCostComposition } from "./costComposition";

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
    viewerPersonal: [],
    lines: [],
    personalLines: [],
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
    // Whole-group by default: nobody has a participation row on one, so an
    // empty list is the truthful shape rather than a placeholder.
    participants: [],
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
            // The people, not just how many: the aside draws them as faces.
            participants: [
              {
                userId: "u-1",
                displayName: "Ada",
                avatarUrl: null,
                joinedAt: "2026-01-01T00:00:00.000Z",
              },
              {
                userId: "u-2",
                displayName: "Grace",
                avatarUrl: null,
                joinedAt: "2026-01-02T00:00:00.000Z",
              },
              {
                userId: "u-3",
                displayName: "Edsger",
                avatarUrl: null,
                joinedAt: "2026-01-03T00:00:00.000Z",
              },
            ],
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
        participants: [
          {
            userId: "u-1",
            displayName: "Ada",
            avatarUrl: null,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            userId: "u-2",
            displayName: "Grace",
            avatarUrl: null,
            joinedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            userId: "u-3",
            displayName: "Edsger",
            avatarUrl: null,
            joinedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
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

describe("myCostComposition", () => {
  let itemSeq = 0;
  const own = (
    amount: number,
    over: Partial<TripDashboardView["personalLines"][number]> = {},
  ): TripDashboardView["personalLines"][number] => {
    itemSeq += 1;
    return {
      itemId: `00000000-0000-4000-8000-${String(itemSeq).padStart(12, "0")}`,
      categoryId: null,
      categoryName: null,
      title: `Item ${itemSeq}`,
      currency: "EUR",
      amount,
      converted: amount,
      ...over,
    };
  };

  it("says nothing when the reader owes nothing and owns nothing", () => {
    expect(myCostComposition(dashboard(), "Just for me")).toBeNull();
  });

  it("draws only the locked money this reader actually owes", () => {
    const d = dashboard({
      lines: [
        line({ perPerson: 300, viewerOwes: true, categoryName: "Stay" }),
        line({ perPerson: 90, viewerOwes: false, categoryName: "Surf" }),
      ],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.charted).toBe(300);
    expect(c.slices.map((s) => s.label)).toEqual(["Stay"]);
  });

  it("keeps an opt-in option the reader joined, which the trip's ring cannot", () => {
    // The trip's chart excludes anything priced for part of the group, because
    // a ring about everyone cannot hold money only some people pay. This ring
    // is about one person, so an option they joined is simply their money.
    const d = dashboard({
      memberCount: 5,
      lines: [
        line({
          perPerson: 40,
          effectiveHeadcount: 2,
          viewerOwes: true,
          categoryName: "Surf",
        }),
      ],
    });
    expect(costComposition(d)).toBeNull();
    const mine = myCostComposition(d, "Just for me")!;
    expect(mine.charted).toBe(40);
    expect(mine.excluded).toEqual([]);
  });

  it("never draws a target ring, whatever the trip's budget says", () => {
    // The verdict under the chart still speaks for the group's plan, and
    // personal money is deliberately no part of that comparison. A ring that
    // folded it in would draw the reader over a target the sentence beneath
    // says they are keeping to.
    const d = dashboard({
      budgetPerPerson: 500,
      lines: [line({ perPerson: 300, viewerOwes: true })],
      personalLines: [own(400)],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.charted).toBe(700);
    expect(c.target).toBeNull();
    expect(c.targetMark).toBeNull();
    expect(c.full).toBe(700);
    expect(c.remaining).toBe(0);
    expect(c.overspend).toBe(0);
  });

  it("puts a tagged item in its lane's wedge", () => {
    const d = dashboard({
      lines: [line({ perPerson: 300, viewerOwes: true, categoryName: "Stay" })],
      personalLines: [
        own(100, { categoryId: "cat-stay", categoryName: "Stay" }),
      ],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.slices).toHaveLength(1);
    expect(c.slices[0]).toMatchObject({ label: "Stay", amount: 400 });
  });

  it("gathers untagged items under one unnamed wedge", () => {
    // They have nothing in common but being untagged, and a ring of one-item
    // slices is a list drawn as a circle. A null `categoryId` is already the
    // chart's word for "no lane, so no hue".
    const d = dashboard({
      lines: [line({ perPerson: 300, viewerOwes: true, categoryName: "Stay" })],
      personalLines: [own(100), own(50)],
    });
    const c = myCostComposition(d, "Just for me")!;
    const untagged = c.slices.find((s) => s.label === "Just for me")!;
    expect(untagged.amount).toBe(150);
    expect(untagged.categoryId).toBeNull();
  });

  it("drops an item it cannot bring into the trip's currency, and names it", () => {
    const d = dashboard({
      personalLines: [
        own(200),
        own(50000, { currency: "HUF", converted: null }),
      ],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.charted).toBe(200);
    expect(c.uncounted).toEqual(["HUF"]);
  });

  it("marks itself approximate when an item had to be converted", () => {
    const d = dashboard({
      personalLines: [own(50000, { currency: "HUF", converted: 130 })],
    });
    expect(myCostComposition(d, "Just for me")!.approximate).toBe(true);
  });
});
