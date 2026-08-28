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
    // No budget of their own unless a case sets one, which is every
    // membership until somebody types a figure.
    viewerBudget: null,
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
    // Derived from the headcount rather than fixed at the member count, because
    // the trip's chart reads `group` now: an option two of four people are in
    // costs the trip two shares, and a helper that said four would have made
    // every opt-in test agree with a chart that was quietly wrong.
    group: perPerson * (over.effectiveHeadcount ?? 4),
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
    // The owner's worked example, in the group money this chart is now in:
    // four members, so 20 + 40 + 200 + 100 = 360 all in, Activities 60 of it.
    // The *fractions* are exactly what they were when this was drawn per
    // person, because every one of these is divided by the same four people.
    expect(c?.charted).toBe(360);
    expect(c?.slices.map((s) => s.label)).toEqual([
      "Stay",
      "Transport",
      "Activities",
    ]);
    expect(c?.slices.find((s) => s.label === "Activities")?.amount).toBe(60);
    expect(c?.slices.find((s) => s.label === "Activities")?.share).toBeCloseTo(
      1 / 6,
    );
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
    expect(c?.charted).toBe(200);
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
  /*
   * This chart used to leave out any option priced for part of the group, and
   * name it in an aside instead. The rule was sound and the unit was not: a
   * per-person figure is only comparable with another per-person figure when
   * both are divided by the same people, so ten euros three of five owe could
   * not sit beside fifty everyone owes.
   *
   * In group money the question does not arise. Thirty euros is thirty euros
   * the trip spends, whoever chips in, and it belongs in the trip's total
   * because the trip is paying it. What the exclusion was really protecting
   * was the per-person *unit* — which is now `myCostComposition`'s, where the
   * same option appears as the reader's own share or not at all.
   */
  it("charts an option only some of the group are paying for", () => {
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
    // 250 the five share, plus 30 the three do. Both are the trip's money.
    expect(c?.charted).toBe(280);
    expect(c?.slices.map((s) => s.label)).toEqual(["Stay", "Transport"]);
    expect(c?.slices.find((s) => s.label === "Transport")?.amount).toBe(30);
  });

  it("charts it whether or not the reader is one of the people paying", () => {
    // The trip's reading is the same for everybody: it is what the group
    // spends, not what the reader owes. `viewerOwes` is the other chart's
    // question, and this one must not quietly answer it.
    const shared = {
      memberCount: 5,
      lines: [line({ perPerson: 10, effectiveHeadcount: 3, viewerOwes: true })],
    };
    const declined = {
      memberCount: 5,
      lines: [
        line({ perPerson: 10, effectiveHeadcount: 3, viewerOwes: false }),
      ],
    };
    expect(costComposition(dashboard(shared))?.charted).toBe(30);
    expect(costComposition(dashboard(declined))?.charted).toBe(30);
  });

  it("still has something to draw when every option is for part of the group", () => {
    // This returned null before, and the surface fell back to printing bare
    // figures. There is no such state now: an option nobody but two people are
    // in is still money the trip is spending.
    const c = costComposition(
      dashboard({
        memberCount: 5,
        lines: [line({ perPerson: 10, effectiveHeadcount: 2 })],
      }),
    );
    expect(c?.charted).toBe(20);
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
    expect(c?.charted).toBe(400);
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
    expect(c?.charted).toBe(200);
    expect(c?.uncounted).toEqual(["RSD"]);
  });
});

describe("what a full circle means", () => {
  it("is the target while there is headroom left", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 200, lines: [line({ perPerson: 50 })] }),
    );
    // The organizer authors 200 a head; four members make the group's target
    // 800, against 200 committed. The share is what it always was.
    expect(c?.full).toBe(800);
    expect(c?.slices[0]?.share).toBeCloseTo(0.25);
    expect(c?.overspend).toBe(0);
  });

  it("is the spend once the target is passed, and marks where it fell", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 100, lines: [line({ perPerson: 150 })] }),
    );
    expect(c?.full).toBe(600);
    expect(c?.overspend).toBe(200);
    expect(c?.overshare).toBeCloseTo(0.5);
    // Without this mark, fifty over and five thousand over are the same full
    // circle — the failure that retired the previous chart.
    expect(c?.targetMark).toBeCloseTo(400 / 600);
  });

  it("keeps the mark at the rim when the spend has only just reached the target", () => {
    const c = costComposition(
      dashboard({ budgetPerPerson: 100, lines: [line({ perPerson: 100 })] }),
    );
    expect(c?.full).toBe(400);
    expect(c?.targetMark).toBe(1);
    expect(c?.overspend).toBe(0);
  });

  it("has no group target on a trip with nobody in it", () => {
    // `target * 0` is zero, and a zero target draws every trip that has spent
    // anything infinitely over it. The absent member count is the missing
    // half of the figure, not a figure of nothing.
    const c = costComposition(
      dashboard({
        budgetPerPerson: 200,
        memberCount: 0,
        lines: [line({ perPerson: 50, effectiveHeadcount: 4 })],
      }),
    );
    expect(c?.target).toBeNull();
    expect(c?.targetMark).toBeNull();
  });

  it("fills its own circle when there is no target to be a fraction of", () => {
    const c = costComposition(dashboard({ lines: [line({ perPerson: 50 })] }));
    expect(c?.full).toBe(200);
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
    expect(c?.slices.at(-1)?.amount).toBe(20);
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

  it("reads an opt-in option as the reader's share, where the trip reads its whole cost", () => {
    // The same option, seen twice, and the difference is the unit rather than
    // whether it is drawn at all: the trip pays 80 for it, and the reader --
    // one of the two who are in -- owes 40.
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
    expect(costComposition(d)?.charted).toBe(80);
    expect(costComposition(d)?.unit).toBe("group");
    const mine = myCostComposition(d, "Just for me")!;
    expect(mine.charted).toBe(40);
    expect(mine.unit).toBe("viewer");
  });

  it("leaves out an option the reader declined, which the trip still pays for", () => {
    const d = dashboard({
      memberCount: 5,
      lines: [
        line({ perPerson: 40, effectiveHeadcount: 2, viewerOwes: false }),
      ],
    });
    expect(costComposition(d)?.charted).toBe(80);
    expect(myCostComposition(d, "Just for me")).toBeNull();
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

  it("draws a ring against the reader's own budget, their own things in it", () => {
    // The whole point of the private budget: 300 owed plus a 400 flight is 700
    // against 900, so there is headroom and the mark sits ahead of the spend.
    const d = dashboard({
      viewerBudget: 900,
      lines: [line({ perPerson: 300, viewerOwes: true })],
      personalLines: [own(400)],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.charted).toBe(700);
    expect(c.target).toBe(900);
    expect(c.full).toBe(900);
    expect(c.remaining).toBe(200);
    expect(c.overspend).toBe(0);
    expect(c.targetMark).toBeCloseTo(1);
  });

  it("marks the overshoot on the reader's ring exactly as it does on the trip's", () => {
    // Same arithmetic, deliberately: both compositions go through
    // `againstTarget`, so one surface cannot draw two kinds of overshoot.
    const mine = myCostComposition(
      dashboard({
        viewerBudget: 500,
        lines: [line({ perPerson: 750, viewerOwes: true })],
      }),
      "Just for me",
    )!;
    const trip = costComposition(
      dashboard({
        budgetPerPerson: 125,
        memberCount: 4,
        lines: [line({ perPerson: 187.5 })],
      }),
    )!;
    expect(mine.overshare).toBeCloseTo(0.5);
    expect(trip.overshare).toBeCloseTo(0.5);
    expect(mine.targetMark).toBeCloseTo(trip.targetMark!);
  });

  it("still never borrows the trip's per-person target", () => {
    // The rule this ring was built without a target for. A budget of their own
    // is the only thing that gives it one.
    const d = dashboard({
      budgetPerPerson: 500,
      viewerBudget: null,
      lines: [line({ perPerson: 300, viewerOwes: true })],
      personalLines: [own(400)],
    });
    const c = myCostComposition(d, "Just for me")!;
    expect(c.charted).toBe(700);
    expect(c.target).toBeNull();
    expect(c.targetMark).toBeNull();
    expect(c.full).toBe(700);
  });
});
