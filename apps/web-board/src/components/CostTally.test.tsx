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
