import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CategoryView } from "@gtp/types";
import type { CostComposition as Composition } from "../lib/costComposition";
import { CostComposition } from "./CostComposition";
import { formatMoney } from "../lib/money";

/**
 * The cost composition: the ring, the breakdown, and what they say together.
 *
 * Two things are covered here that the model's own tests cannot see, because
 * both are about what reaches the reader rather than what the arithmetic
 * produced:
 *
 * 1. **The overshoot is named.** It used to be a bare radial tick on the ring
 *    whose meaning depended on knowing the circle is scaled to
 *    `max(spend, target)` — a step nobody performs — and it landed mid-wedge,
 *    where it read as a divider inside a lane. It is a length on its own band
 *    now, and, crucially, a row in the list: a mark on a chart with no matching
 *    line is exactly the thing a reader has to guess at.
 * 2. **The hover reveals what the ring cannot say.** A wedge can tell you a
 *    lane is a third of the trip; it cannot tell you which decisions that third
 *    was. That is the whole point of the interaction, and it has to work from
 *    the list as well as the ring, because the ring is `aria-hidden` and a
 *    keyboard never touches it.
 */

const categories: CategoryView[] = [
  {
    id: "c1",
    name: "Stay",
    singleChoice: true,
    isBuiltin: true,
    builtinKey: "ACCOMMODATION",
    paletteKey: null,
    position: 0,
    version: 0,
  },
  {
    id: "c2",
    name: "Travel",
    singleChoice: false,
    isBuiltin: true,
    builtinKey: "TRANSPORT",
    paletteKey: null,
    position: 1,
    version: 0,
  },
];

function composition(over: Partial<Composition> = {}): Composition {
  return {
    currency: "EUR",
    approximate: false,
    slices: [
      {
        categoryId: "c1",
        label: "Stay",
        amount: 300,
        share: 0.6,
      },
      {
        categoryId: "c2",
        label: "Travel",
        amount: 200,
        share: 0.4,
      },
    ],
    charted: 500,
    target: null,
    full: 500,
    remaining: 0,
    overspend: 0,
    overshare: 0,
    targetMark: null,
    excluded: [],
    uncounted: [],
    ...over,
  };
}

const headline = { headline: "€500", caption: "per person" };

function renderComp(over: Partial<Composition> = {}) {
  return render(
    <CostComposition
      composition={composition(over)}
      categories={categories}
      headline={headline}
      myUserId="u-me"
    />,
  );
}

describe("the overshoot is said, not just drawn", () => {
  it("names it in the breakdown with its own figure", () => {
    renderComp({
      target: 400,
      overspend: 100,
      overshare: 0.25,
      targetMark: 0.8,
    });

    // Deliberately not asserting the formatted string. This machine renders
    // money in Hungarian and CI does not, and locale-formatted text has broken
    // a test in this repo three separate times now. The claim worth making is
    // that the row exists and carries a figure of its own.
    const row = screen.getByText("Over budget").closest("li")!;
    expect(within(row).getByText(/100/)).toBeInTheDocument();
  });

  it("says nothing about being over when the trip is under target", () => {
    renderComp({ target: 900, overspend: 0, targetMark: 0.55 });
    expect(screen.queryByText("Over budget")).toBeNull();
  });

  it("draws the overshoot as a band, not a bare tick", () => {
    // The tick alone was the complaint: a mark whose length said nothing.
    // The band's length is what carries "how far over".
    const { container } = renderComp({
      target: 400,
      overspend: 100,
      overshare: 0.25,
      targetMark: 0.8,
    });
    expect(container.querySelector(".cost-donut__over")).not.toBeNull();
  });

  it("draws no overshoot mark at all under target", () => {
    const { container } = renderComp({ target: 900, targetMark: 0.55 });
    expect(container.querySelector(".cost-donut__over")).toBeNull();
    expect(container.querySelector(".cost-donut__limit")).toBeNull();
  });
});

/**
 * The middle of the ring while a part is being read, or null when nothing is.
 *
 * Every claim below is scoped to it, because every word in there also appears
 * in the legend beside it — "Stay" is a row as well as a wedge — and an
 * unscoped query would pass on the row while the hole said nothing at all.
 */
function hole(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".cost-donut__centre--active");
}

describe("reading one lane", () => {
  it("names the lane and states its money", () => {
    renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));

    // Not a literal: `Intl` is asked for the runtime's locale, so 300 EUR is
    // "300 EUR" on a Hungarian machine and "€300" on CI — and the space it puts
    // between them is U+00A0, which Testing Library collapses in the DOM but
    // not in the string handed to it.
    const written = formatMoney(300, "EUR").replace(/\s/g, " ");
    expect(within(hole()!).getByText("Stay")).toBeVisible();
    expect(within(hole()!).getByText(written)).toBeVisible();
  });

  it("says nothing about the decisions behind the figure", () => {
    // The hole used to name them — three at most, with the rest counted — and
    // the hole is the wrong size for a list: 0.56rem titles inside 78px,
    // appearing and vanishing under the pointer. The lane on the board is where
    // those decisions are read. Asserted as "two lines", so re-adding any third
    // thing to the middle of the ring has to come past this test.
    renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));
    expect(hole()!.children).toHaveLength(2);
  });

  it("works from the keyboard, since the ring itself is decoration", () => {
    renderComp();
    // The chart is aria-hidden, so if focus did not do this it would be a
    // mouse-only feature wearing an affordance.
    fireEvent.focus(screen.getByRole("button", { name: /Travel/ }));
    expect(within(hole()!).getByText("Travel")).toBeVisible();
  });

  it("shows one lane at a time", () => {
    renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));
    expect(within(hole()!).getByText("Stay")).toBeVisible();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Travel/ }));
    expect(within(hole()!).queryByText("Stay")).toBeNull();
    expect(within(hole()!).getByText("Travel")).toBeVisible();
  });

  it("puts the lane back when the reader leaves", () => {
    renderComp();
    const stay = screen.getByRole("button", { name: /Stay/ });
    fireEvent.mouseEnter(stay);
    expect(hole()).not.toBeNull();

    fireEvent.mouseLeave(stay);
    expect(hole()).toBeNull();
    // And the trip's own figure is back in the hole.
    expect(screen.getByText("€500")).toBeInTheDocument();
  });

  it("lifts the wedge belonging to the row being read", () => {
    const { container } = renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));

    // The ring and the list are two views of one selection; a second local
    // state in either would let them disagree, which is the one thing a chart
    // and its legend must never do.
    expect(container.querySelector(".cost-donut__wedge--on")).not.toBeNull();
    expect(container.querySelector(".cost-donut__wedge--off")).not.toBeNull();
  });

  it("always states the total when nothing is being read", () => {
    renderComp();
    expect(screen.getByText("€500")).toBeInTheDocument();
    expect(screen.getByText("per person")).toBeInTheDocument();
  });

  it("does not put the wedge's share in the hole", () => {
    // The share was the first line trimmed out of the middle of the ring: the
    // wedge in front of the reader already *is* the share, drawn, and the same
    // percentage is printed on the row being hovered.
    renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));
    expect(hole()!.textContent).not.toMatch(/60\s*%/);
  });
});

describe("the money still inside the target", () => {
  // The grey arc used to be the one stretch of the ring that did nothing when
  // you pointed at it, which made it read as background rather than as an
  // answer — when it is in fact the most actionable figure on the surface, and
  // the reader was being left to subtract for it.
  const underTarget = {
    target: 800,
    full: 800,
    remaining: 300,
    targetMark: 1,
    slices: [
      {
        categoryId: "c1",
        label: "Stay",
        amount: 300,
        share: 0.375,
      },
      {
        categoryId: "c2",
        label: "Travel",
        amount: 200,
        share: 0.25,
      },
    ],
  };

  it("names what is left, with its share, in the breakdown", () => {
    renderComp(underTarget);
    const row = screen.getByRole("button", { name: /Still to spend/ });
    // 300 of an 800 circle. Quoted against the same denominator the wedges use,
    // so the rows sum to the ring.
    expect(row).toHaveTextContent("38%");
  });

  it("puts the spendable figure in the hole when it is read", () => {
    renderComp(underTarget);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /Still to spend/ }),
    );

    const centre = document.querySelector(".cost-donut__centre--active")!;
    const written = formatMoney(300, "EUR").replace(/\s/g, " ");
    expect(within(centre as HTMLElement).getByText(written)).toBeVisible();
    expect(centre.textContent).toMatch(/Still to spend/);
  });

  it("lifts the grey arc and dims the wedges, exactly as a lane does", () => {
    const { container } = renderComp(underTarget);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /Still to spend/ }),
    );

    expect(container.querySelector(".cost-donut__headroom--on")).not.toBeNull();
    expect(container.querySelectorAll(".cost-donut__wedge--off")).toHaveLength(
      2,
    );
  });

  it("is reachable from the keyboard, since the ring is decoration", () => {
    renderComp(underTarget);
    fireEvent.focus(screen.getByRole("button", { name: /Still to spend/ }));
    expect(
      document.querySelector(".cost-donut__centre--active")?.textContent,
    ).toMatch(/Still to spend/);
  });

  it("says nothing at all once the target is met", () => {
    // No remainder, no row, no mark — the ring is all spend and there is
    // nothing left to name.
    renderComp({ target: 400, full: 500, remaining: 0, overspend: 100 });
    expect(screen.queryByRole("button", { name: /Still to spend/ })).toBeNull();
  });

  it("marks the arc, but not when it is too thin to hold a glyph", () => {
    const { container } = renderComp(underTarget);
    // Three marks: two lanes and the remainder — and the remainder's is one of
    // them rather than a special case. It used to carry `--quiet`, which drew
    // it in the dim ink because the grey arc under it was too pale to hold
    // white. The arc is darker now, so the ring's marks are one set.
    expect(container.querySelectorAll(".cost-donut__mark")).toHaveLength(3);
    expect(container.querySelectorAll(".cost-donut__mark--quiet")).toHaveLength(
      0,
    );

    const sliver = renderComp({
      target: 505,
      full: 505,
      remaining: 5,
      targetMark: 1,
    });
    expect(
      sliver.container.querySelectorAll(".cost-donut__mark--quiet"),
    ).toHaveLength(0);
  });
});

describe("marking a wedge with its lane's own glyph", () => {
  it("draws one per wedge that has the room", () => {
    const { container } = renderComp();
    // Two lanes, 60/40 — both comfortably longer than a glyph, so both are
    // marked. The mark is the same drawing the lane header wears, which is what
    // lets the eye cross from the chart to the board without a legend.
    expect(container.querySelectorAll(".cost-donut__mark")).toHaveLength(2);
  });

  it("leaves a sliver unmarked rather than cramming one in", () => {
    const { container } = renderComp({
      slices: [
        {
          categoryId: "c1",
          label: "Stay",
          amount: 495,
          share: 0.99,
        },
        {
          categoryId: "c2",
          label: "Travel",
          amount: 5,
          share: 0.01,
        },
      ],
    });
    // A 1% wedge is about 3 units of a 300-unit ring: a 12-unit glyph on it
    // would overlap both its neighbours and say nothing the list beside it does
    // not already say in words.
    expect(container.querySelectorAll(".cost-donut__mark")).toHaveLength(1);
  });

  it("dims the marks of the lanes not being read", () => {
    const { container } = renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));

    // Or a glyph floats at full strength over a faded band, which reads as the
    // chart having two selections.
    expect(container.querySelectorAll(".cost-donut__mark--off")).toHaveLength(
      1,
    );
  });

  it("never marks the folded tail, which is not a lane", () => {
    const { container } = renderComp({
      slices: [
        {
          categoryId: "c1",
          label: "Stay",
          amount: 300,
          share: 0.6,
        },
        {
          categoryId: null,
          label: "Everything else",
          amount: 200,
          share: 0.4,
        },
      ],
    });
    expect(container.querySelectorAll(".cost-donut__mark")).toHaveLength(1);
  });
});
