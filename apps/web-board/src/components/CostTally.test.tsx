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
    converted: null,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

/** An approximate all-in total, as the server would send it. */
function convertedTo(
  currency: string,
  group: number,
  perPerson: number,
  missing: string[] = [],
): TripDashboardView["converted"] {
  return {
    currency,
    committed: { group: 0, perPerson: 0 },
    projected: { group, perPerson },
    asOf: "2026-08-12",
    converted: [currency],
    missing,
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

describe("CostTally approximate total", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("answers what the whole thing comes to across currencies", async () => {
    renderTally(
      dashboard({
        projected: [priced(500), priced(90000, "HUF")],
        converted: convertedTo("EUR", 2725, 725),
      }),
    );
    // Two figures — the group total and the per-person one — each marked as an
    // approximation, plus the provenance of the rates that produced them.
    const figures = await screen.findAllByText(/≈/);
    expect(figures).toHaveLength(2);
    expect(screen.getByText(/rates of/)).toBeInTheDocument();
    // Rounded to whole units: cents would claim a precision a daily rate has
    // not got. (How the currency itself is written is the locale's business,
    // so that is asserted in the formatter's own suite, not here.)
    expect(figures[0]!.textContent).not.toMatch(/\d[.,]\d{2}\b/);
  });

  it("says nothing when every price is already in the trip's currency", async () => {
    // The approximation would equal a figure one line above it, exactly.
    renderTally(
      dashboard({
        projected: [priced(500)],
        converted: convertedTo("EUR", 2000, 500),
      }),
    );
    await screen.findByText(/per currency/);
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("names what it could not convert rather than looking complete", async () => {
    renderTally(
      dashboard({
        projected: [priced(500), priced(60000, "RSD")],
        converted: convertedTo("EUR", 2000, 500, ["RSD"]),
      }),
    );
    expect(await screen.findByText(/RSD not converted/)).toBeInTheDocument();
  });

  it("shows nothing at all when the server sent no conversion", async () => {
    // No rates stored, or none for this trip's currency: the app is exactly
    // the per-currency one it was before conversion existed.
    renderTally(dashboard({ projected: [priced(500), priced(90000, "HUF")] }));
    await screen.findByText(/per currency/);
    expect(screen.queryByText(/≈/)).toBeNull();
  });
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

  it("reads the whole trip once there is an all-in figure", async () => {
    // The target's whole point is "what will this trip cost me", and before
    // conversion it could only answer for one currency's worth of that. The
    // verdict is approximate now, and marked so — it is the line someone acts
    // on, which is exactly why it must not overstate what it knows.
    renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(300), priced(60000, "HUF")],
        converted: convertedTo("EUR", 1860, 465),
      }),
    );
    const verdict = await screen.findByText(/to spare/);
    expect(verdict.textContent).toContain("≈");
    // 800 − 465, not 800 − 300: the forints are in the picture now.
    expect(verdict.textContent?.replace(/\D/g, "")).toContain("335");
    expect(screen.queryByText(/HUF not counted/)).toBeNull();
  });

  it("says what no rate could reach exactly once", async () => {
    // The caveat belongs to the conversion, which the line above describes.
    // Repeating it in the verdict one line down reads as two problems.
    renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(300), priced(60000, "RSD")],
        converted: convertedTo("EUR", 1200, 300, ["RSD"]),
      }),
    );
    const notes = await screen.findAllByText(/RSD not converted/);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveClass("board__approx-note");
  });

  it("hands the target to the all-in figure, not to one currency's bar", async () => {
    // Scaling the EUR bar against a budget that now spans three currencies
    // would report "a third of the budget spent" while the forints sat
    // invisibly outside the bar. One target, one place.
    const { container } = renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(300), priced(60000, "HUF")],
        converted: convertedTo("EUR", 1860, 465),
      }),
    );
    await screen.findByText(/to spare/);
    expect(container.querySelector(".tally-bar--target")).toBeNull();
    expect(container.querySelector(".tally-bar__limit")).toBeNull();
  });

  it("keeps the target on the bar for a single-currency trip", async () => {
    // Nothing changes for the ordinary trip: no conversion is shown, so the
    // bar goes on answering for the target exactly as it did.
    const { container } = renderTally(
      dashboard({
        budgetPerPerson: 800,
        projected: [priced(500)],
        converted: convertedTo("EUR", 2000, 500),
      }),
    );
    await screen.findByText(/to spare/);
    expect(container.querySelector(".tally-bar--target")).not.toBeNull();
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
