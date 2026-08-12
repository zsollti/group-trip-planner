import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { TripDashboardView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { CostTally } from "./CostTally";

/**
 * The cost strip's **budget line** — the per-person target, and how the
 * projection is doing against it.
 *
 * Money is formatted in the reader's locale, so nothing here asserts a literal
 * amount string; what is asserted is the judgement the line makes, which is the
 * part that can be wrong.
 */

const JSON_HEADERS = { "content-type": "application/json" };

function dashboard(over: Partial<TripDashboardView> = {}): TripDashboardView {
  return {
    tripId: "t1",
    defaultCurrency: "EUR",
    budgetPerPerson: null,
    memberCount: 4,
    committed: [],
    projected: [],
    lines: [],
    hasStaleHeadcount: false,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

function renderTally(d: TripDashboardView) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(d), { status: 200, headers: JSON_HEADERS }),
    ),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CostTally tripId="t1" />
    </QueryClientProvider>,
  );
}

const priced = (perPerson: number, currency = "EUR") => ({
  currency,
  group: perPerson * 4,
  perPerson,
});

describe("CostTally budget line", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("says nothing when no target is set", async () => {
    renderTally(dashboard({ projected: [priced(200)] }));
    await screen.findByText(/per currency/);
    expect(screen.queryByText(/Target/)).toBeNull();
  });

  it("shows what is left when the projection is under", async () => {
    renderTally(dashboard({ budgetPerPerson: 800, projected: [priced(500)] }));
    expect(await screen.findByText("Target")).toBeInTheDocument();
    expect(screen.getByText(/to spare/)).toBeInTheDocument();
    expect(screen.queryByText(/over/)).toBeNull();
  });

  it("says by how much when the projection is over", async () => {
    renderTally(dashboard({ budgetPerPerson: 400, projected: [priced(500)] }));
    expect(await screen.findByText(/over/)).toBeInTheDocument();
    expect(screen.queryByText(/to spare/)).toBeNull();
  });

  it("compares against the projection, not what is already locked", async () => {
    // A target answers "what will this cost us if the front-runners win".
    // Reading it against the committed total would say "fine" right up until
    // the trip was fully decided.
    renderTally(
      dashboard({
        budgetPerPerson: 400,
        committed: [priced(100)],
        projected: [priced(500)],
      }),
    );
    expect(await screen.findByText(/over/)).toBeInTheDocument();
  });

  it("names the currencies it is not counting", async () => {
    // Totals are never converted (FR-27), so a target can only speak to the
    // trip's own currency. Staying silent would imply the rest were covered.
    renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(500), priced(90000, "HUF")],
      }),
    );
    expect(await screen.findByText(/HUF not counted/)).toBeInTheDocument();
  });

  it("scales the bar to the target while the projection is under it", async () => {
    // 500 per person of an 800 target: the fill is five eighths of the track,
    // and the empty three eighths are the room left. The arithmetic has its own
    // unit tests; what is asserted here is that the bar was given the target at
    // all, and given it in the unit it is denominated in.
    const { container } = renderTally(
      dashboard({ budgetPerPerson: 800, projected: [priced(500)] }),
    );
    await screen.findByText(/to spare/);
    const bar = container.querySelector(".tally-bar");
    expect(bar).toHaveClass("tally-bar--target");
    expect(bar?.querySelector(".tally-bar__limit")).toBeNull();
    const filled = [...container.querySelectorAll(".tally-bar__seg")].reduce(
      (sum, seg) => sum + parseFloat((seg as HTMLElement).style.width),
      0,
    );
    expect(filled).toBeCloseTo(62.5);
  });

  it("marks where the target ran out once the projection is over it", async () => {
    const { container } = renderTally(
      dashboard({ budgetPerPerson: 400, projected: [priced(500)] }),
    );
    await screen.findByText(/over/);
    const limit = container.querySelector(".tally-bar__limit");
    // 400 of 500 spent: four fifths along, with the overshoot past it.
    expect((limit as HTMLElement).style.left).toBe("80%");
    expect(container.querySelector(".tally-bar")).not.toHaveClass(
      "tally-bar--target",
    );
  });

  it("leaves the bars of other currencies scaled to themselves", async () => {
    // Totals are never converted (FR-27), so a target in EUR must not redraw
    // the HUF bar — which would be the same silent cross-currency comparison
    // the budget line is careful to refuse in words.
    const { container } = renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(500), priced(90000, "HUF")],
      }),
    );
    await screen.findByText(/HUF not counted/);
    const bars = container.querySelectorAll(".tally-bar");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveClass("tally-bar--target");
    expect(bars[1]).not.toHaveClass("tally-bar--target");
    expect(bars[1]?.querySelector(".tally-bar__limit")).toBeNull();
  });

  it("reads a fixed-headcount trip in the unit the target is written in", async () => {
    // The catch this guards: an option split among a fixed four on a trip of
    // eight makes `perPerson` something other than `group / memberCount`. A bar
    // scaled on group money would then put the mark somewhere the sentence
    // under it contradicts. Here the target is met per person (400 ≤ 400) while
    // the group figure over the headcount (3200/8 = 400) only coincidentally
    // agrees — so the bar must be full but unmarked, not overflowing.
    const { container } = renderTally(
      dashboard({
        budgetPerPerson: 400,
        memberCount: 8,
        projected: [{ currency: "EUR", group: 3200, perPerson: 400 }],
      }),
    );
    await screen.findByText(/to spare|over/);
    expect(container.querySelector(".tally-bar")).toHaveClass(
      "tally-bar--target",
    );
    expect(container.querySelector(".tally-bar__limit")).toBeNull();
  });

  it("shows the target before anything has been priced", async () => {
    // The tally itself only draws once something has a price. A target that
    // stayed invisible until then would read as an edit that failed to save.
    renderTally(dashboard({ budgetPerPerson: 800 }));
    expect(await screen.findByText("Target")).toBeInTheDocument();
    expect(
      screen.getByText(/Price an option to start the tally/),
    ).toBeInTheDocument();
  });
});
