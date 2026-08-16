import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CategoryView } from "@gtp/types";
import type { CostComposition as Composition } from "../lib/costComposition";
import { CostComposition } from "./CostComposition";

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
    builtinKey: "TRAVEL",
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
        parts: [
          { label: "Beach House", amount: 220 },
          { label: "Airport hotel", amount: 80 },
        ],
      },
      {
        categoryId: "c2",
        label: "Travel",
        amount: 200,
        share: 0.4,
        parts: [{ label: "Ryanair FR1234", amount: 200 }],
      },
    ],
    charted: 500,
    target: null,
    full: 500,
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

describe("reading one lane", () => {
  it("names the options a lane's money went on", () => {
    renderComp();
    // The question the ring raises and cannot answer.
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));

    expect(screen.getByText("Beach House")).toBeInTheDocument();
    expect(screen.getByText("Airport hotel")).toBeInTheDocument();
  });

  it("works from the keyboard, since the ring itself is decoration", () => {
    renderComp();
    // The chart is aria-hidden, so if focus did not do this it would be a
    // mouse-only feature wearing an affordance.
    fireEvent.focus(screen.getByRole("button", { name: /Travel/ }));
    expect(screen.getByText("Ryanair FR1234")).toBeInTheDocument();
  });

  it("shows one lane at a time", () => {
    renderComp();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Stay/ }));
    expect(screen.getByText("Beach House")).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Travel/ }));
    expect(screen.queryByText("Beach House")).toBeNull();
    expect(screen.getByText("Ryanair FR1234")).toBeInTheDocument();
  });

  it("puts the lane back when the reader leaves", () => {
    renderComp();
    const stay = screen.getByRole("button", { name: /Stay/ });
    fireEvent.mouseEnter(stay);
    expect(screen.getByText("Beach House")).toBeInTheDocument();

    fireEvent.mouseLeave(stay);
    expect(screen.queryByText("Beach House")).toBeNull();
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
});
