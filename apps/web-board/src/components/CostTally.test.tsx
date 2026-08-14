import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { TripDashboardView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { CostTally } from "./CostTally";

/**
 * The cost strip, rebuilt around **locked money only**.
 *
 * The decisions worth pinning are what the surface refuses to say: it never
 * charts without a target, never combines currencies it has no rate for, and
 * never draws the projection it used to give most of its space to. The
 * arithmetic behind each is unit-tested in `lib/costSummary` and
 * `lib/costScale`; what is asserted here is what reaches the screen.
 *
 * Money is formatted in the reader's locale, so nothing asserts a literal
 * amount string — only digits, and the judgements the strip makes.
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
    committed: { group, perPerson },
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

/** Just the digits, so a locale's separators cannot break an assertion. */
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

describe("CostTally", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows what is locked, not what the front-runners would add", async () => {
    // The change this slice is: the projection used to be the larger part of
    // every bar, which made the money actually committed the harder half to
    // read. It is not drawn at all now.
    const { container } = renderTally(
      dashboard({
        committed: [priced(100)],
        projected: [priced(1000)],
      }),
    );
    const total = await screen.findByText((_, el) =>
      el?.className === "board__tally-total" ? true : false,
    );
    // 400 locked (100 × 4 members), never the 4000 the front-runners promise.
    expect(digits(total.textContent)).toContain("400");
    expect(digits(total.textContent)).not.toContain("4000");
    // And no hatched second segment survives anywhere.
    expect(container.querySelector(".tally-bar__seg--extra")).toBeNull();
  });

  it("draws no chart when there is no target to draw one against", async () => {
    // A bar filled to its own total is the same picture whatever the number is.
    // The figure carries it instead.
    const { container } = renderTally(dashboard({ committed: [priced(100)] }));
    await screen.findByText(/per person/);
    expect(container.querySelector(".tally-bar")).toBeNull();
  });

  it("charts the locked spend against the target when there is one", async () => {
    // 500 per person of an 800 target: five eighths of the track filled, the
    // rest of it the room left. The arithmetic has its own unit tests; this
    // asserts the bar was given the target, in the unit the target is in.
    const { container } = renderTally(
      dashboard({ budgetPerPerson: 800, committed: [priced(500)] }),
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

  it("marks where the target ran out once the spend is over it", async () => {
    const { container } = renderTally(
      dashboard({ budgetPerPerson: 400, committed: [priced(500)] }),
    );
    await screen.findByText(/over/);
    const limit = container.querySelector(".tally-bar__limit");
    // 400 of 500 spent: four fifths along, the overshoot past it.
    expect((limit as HTMLElement).style.left).toBe("80%");
    expect(container.querySelector(".tally-bar")).not.toHaveClass(
      "tally-bar--target",
    );
  });

  it("adds several currencies into one figure and shows the sum it made", async () => {
    renderTally(
      dashboard({
        committed: [priced(100), priced(8750, "HUF")],
        converted: convertedTo("EUR", 500, 125),
      }),
    );
    // The total, marked as the approximation it is...
    const figures = await screen.findAllByText(/≈/);
    expect(figures.length).toBeGreaterThan(0);
    // ...and, under it, the exact parts it was made of — which is what FR-27
    // guarantees and what a reader asks for the moment they see an ≈.
    const sum = document.querySelector(".board__tally-sum");
    expect(digits(sum?.textContent)).toContain("400");
    expect(digits(sum?.textContent)).toContain("35000");
    expect(screen.getByText(/converted at/)).toBeInTheDocument();
  });

  it("does not restate the total in the line that breaks it down", async () => {
    // Two answers to one question, a few pixels apart, is how this surface got
    // hard to read in the first place.
    renderTally(
      dashboard({
        committed: [priced(100), priced(8750, "HUF")],
        converted: convertedTo("EUR", 500, 125),
      }),
    );
    await screen.findByText(/converted at/);
    const sum = document.querySelector(".board__tally-sum");
    expect(sum?.textContent).not.toContain("=");
    expect(sum?.textContent).not.toContain("≈");
  });

  it("keeps a single-currency trip exact, with no ≈ and no breakdown", async () => {
    // Converting a figure that needs no conversion would trade a number that is
    // right for one that is roughly right.
    renderTally(
      dashboard({
        committed: [priced(100)],
        converted: convertedTo("EUR", 400, 100),
      }),
    );
    await screen.findByText(/per person/);
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(document.querySelector(".board__tally-sum")).toBeNull();
  });

  it("refuses to add currencies it has no rate for", async () => {
    // FR-27 at its sharpest: the parts stand unfinished rather than being
    // summed. No rates are configured in any test, which is also how the suite
    // stays offline.
    renderTally(dashboard({ committed: [priced(100), priced(8750, "HUF")] }));
    expect(await screen.findByText(/no rate to add these up/)).toBeVisible();
    const total = document.querySelector(".board__tally-total");
    expect(digits(total?.textContent)).toContain("400");
    expect(digits(total?.textContent)).toContain("35000");
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("names what it could not convert rather than looking complete", async () => {
    renderTally(
      dashboard({
        committed: [priced(100), priced(15000, "RSD")],
        converted: convertedTo("EUR", 400, 100, ["RSD"]),
      }),
    );
    expect(await screen.findByText(/RSD not converted/)).toBeInTheDocument();
  });

  it("says what the target does not cover, exactly once", async () => {
    // Without rates the verdict speaks for one currency, and has to say so.
    renderTally(
      dashboard({
        budgetPerPerson: 800,
        committed: [priced(100), priced(8750, "HUF")],
      }),
    );
    const notes = await screen.findAllByText(/HUF not counted/);
    expect(notes).toHaveLength(1);
  });

  it("shows the target before anything has been locked", async () => {
    // A target that stayed invisible until the first price would read as an
    // edit that failed to save.
    renderTally(dashboard({ budgetPerPerson: 800 }));
    expect(await screen.findByText("Target")).toBeInTheDocument();
    expect(
      screen.getByText(/Lock a priced option to start the tally/),
    ).toBeInTheDocument();
  });

  it("peeks the one committed figure, not an arrow to a projection", async () => {
    // The collapsed line used to read "€300 → €300 +": the locked total, the
    // projection, and a bare "+" for every other currency — three ideas, none
    // of them the one being asked for.
    renderTally(
      dashboard({
        committed: [priced(100)],
        projected: [priced(1000)],
      }),
    );
    const peek = await screen.findByText((_, el) =>
      el?.className === "board__cost-peek" ? true : false,
    );
    expect(peek.textContent).not.toContain("→");
    expect(digits(peek.textContent)).toBe("400");
  });

  it("still warns about a stale fixed headcount", async () => {
    renderTally(
      dashboard({ committed: [priced(100)], hasStaleHeadcount: true }),
    );
    expect(
      await screen.findByText(/headcount out of date/),
    ).toBeInTheDocument();
  });
});
