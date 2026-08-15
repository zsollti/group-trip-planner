import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  CategoryView,
  DashboardLine,
  TripDashboardView,
} from "@gtp/types";
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

/**
 * A lane, as the board knows it. The charts need each category's palette, which
 * the cost lines — being about money — do not carry.
 */
function category(over: Partial<CategoryView> = {}): CategoryView {
  return {
    id: "cat-stay",
    name: "Stay",
    singleChoice: true,
    isBuiltin: true,
    builtinKey: "ACCOMMODATION",
    paletteKey: null,
    position: 0,
    version: 1,
    ...over,
  };
}

function renderTally(
  d: TripDashboardView,
  categories: readonly CategoryView[] = [],
) {
  // Routed by URL rather than answering everything with the dashboard: the
  // strip fetches its lanes too now, and handing those the cost payload would
  // fail in a way that says nothing about the test.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const body = String(url).includes("/categories") ? categories : d;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CostTally tripId="t1" />
    </QueryClientProvider>,
  );
}

let lineSeq = 0;
/** One locked, priced option, as the cost payload reports it. */
function locked(over: Partial<DashboardLine> = {}): DashboardLine {
  lineSeq += 1;
  const perPerson = over.perPerson ?? 100;
  return {
    optionId: `opt-${lineSeq}`,
    categoryId: "cat-stay",
    categoryName: "Stay",
    title: `Option ${lineSeq}`,
    kind: "LOCKED",
    currency: "EUR",
    group: perPerson * 4,
    perPerson,
    effectiveHeadcount: 4,
    headcountStale: false,
    converted: null,
    ...over,
  };
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

  it("keeps the exact parts of an approximate figure reachable, not printed", async () => {
    renderTally(
      dashboard({
        committed: [priced(100), priced(8750, "HUF")],
        converted: convertedTo("EUR", 500, 125),
      }),
    );
    // The total, marked as the approximation it is...
    const figures = await screen.findAllByText(/≈/);
    expect(figures.length).toBeGreaterThan(0);

    // ...and the exact per-currency sums FR-27 guarantees, still reachable —
    // as the figure's tooltip and its screen-reader text. They used to be a
    // line of their own, which said nothing on a single-currency trip and
    // repeated the total in longhand on a mixed one.
    const total = document.querySelector(".board__tally-total");
    const exact = total?.querySelector("strong")?.getAttribute("title");
    expect(digits(exact)).toContain("400");
    expect(digits(exact)).toContain("35000");
    expect(digits(total?.querySelector(".board__sr-only")?.textContent)).toBe(
      digits(exact),
    );

    // And the rates' publication date is gone: provenance for a figure nobody
    // asked the provenance of, printed under every approximate total.
    expect(screen.queryByText(/converted at/)).toBeNull();
  });

  it("states the money once, with no line restating it", async () => {
    // Two answers to one question, a few pixels apart, is how this surface got
    // hard to read in the first place. The breakdown line is gone entirely, so
    // this is now structural rather than a rule the line had to keep.
    renderTally(
      dashboard({
        committed: [priced(100), priced(8750, "HUF")],
        converted: convertedTo("EUR", 500, 125),
      }),
    );
    await screen.findAllByText(/≈/);
    expect(document.querySelector(".board__tally-sum")).toBeNull();
    expect(document.querySelectorAll(".board__tally-total")).toHaveLength(1);
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

  it("is a plain panel — no disclosure, no label, no group total", async () => {
    // It was a <details> headed "💶 Locked in" with a peek figure beside it and
    // the group total large beneath. The composition inside states the
    // per-person figure once, in the unit the target is in; the label and the
    // two extra figures were captions for a panel that says what it is.
    const { container } = renderTally(
      dashboard({
        committed: [priced(100)],
        projected: [priced(1000)],
        lines: [locked({ perPerson: 100 })],
      }),
      [category()],
    );
    await screen.findByText(/per person/);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText(/Locked in/)).toBeNull();
    expect(container.querySelector(".board__cost-peek")).toBeNull();
    // The chart carries the figure now, so the headline block is not rendered.
    expect(container.querySelector(".board__tally-total")).toBeNull();
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

/**
 * Where the money went — the question the strip could not previously answer at
 * all, in either of its two drawings.
 *
 * The chart itself is `aria-hidden` decoration; what these assert is the part
 * that must survive without it. Both forms are drawn from one model, so the
 * tests that matter are about the model reaching the screen intact and about
 * the surface refusing to draw what it cannot stand behind.
 */
describe("the cost composition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The chart choice is persisted per browser, so it outlives a render and
    // would otherwise leak from whichever test last switched to the bar.
    window.localStorage.clear();
  });

  const LANES = [
    category({ id: "cat-stay", name: "Stay", builtinKey: "ACCOMMODATION" }),
    category({ id: "cat-go", name: "Transport", builtinKey: "TRANSPORT" }),
    category({ id: "cat-do", name: "Activities", builtinKey: "ACTIVITIES" }),
  ];

  /** The owner's worked example: 100 all in, split 50 / 25 / 15, 10 spare. */
  const worked = () =>
    dashboard({
      committed: [priced(90)],
      lines: [
        locked({ categoryId: "cat-stay", categoryName: "Stay", perPerson: 50 }),
        locked({
          categoryId: "cat-go",
          categoryName: "Transport",
          perPerson: 25,
        }),
        locked({
          categoryId: "cat-do",
          categoryName: "Activities",
          perPerson: 5,
        }),
        locked({
          categoryId: "cat-do",
          categoryName: "Activities",
          perPerson: 10,
        }),
      ],
      budgetPerPerson: 100,
    });

  it("gives every lane a share, summing a lane's options into one", async () => {
    renderTally(worked(), LANES);
    // Activities is two locked options, 5 + 10, and reads as one 15% wedge.
    const activities = await screen.findByText("Activities");
    const row = activities.closest(".cost-comp__row");
    expect(row?.querySelector(".cost-comp__share")?.textContent).toBe("15%");
    expect(
      row?.querySelector(".cost-comp__amount")?.textContent,
    ).toContain("15");
  });

  it("names every lane in text, so the colours are never the only channel", async () => {
    // Two of the board's eight palettes are hard to separate as adjacent
    // wedges. This list is what keeps that cosmetic.
    renderTally(worked(), LANES);
    for (const name of ["Stay", "Transport", "Activities"]) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
  });

  it("paints each wedge in its own lane's hue, not in its rank's", async () => {
    const { container } = renderTally(worked(), LANES);
    await screen.findByText("Stay");
    const hues = [...container.querySelectorAll(".cost-donut__wedge")].map((w) =>
      (w as SVGElement).style.getPropertyValue("--cat-hue"),
    );
    // Accommodation is amber (25) and leads on size; transport is sky (200).
    expect(hues[0]).toBe("25");
    expect(hues).toContain("200");
  });

  it("swaps the drawing without touching the figures", async () => {
    const { container } = renderTally(worked(), LANES);
    await screen.findByText("Stay");
    expect(container.querySelector(".cost-donut")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bar" }));
    expect(container.querySelector(".cost-donut")).toBeNull();
    expect(container.querySelectorAll(".tally-bar__seg--cat")).toHaveLength(3);
    // The legend is the same list either way — it is the model, not the chart.
    expect(screen.getByText("Activities")).toBeInTheDocument();
  });

  it("marks where the budget ran out and says how far past it", async () => {
    const { container } = renderTally(
      dashboard({
        committed: [priced(150)],
        lines: [locked({ perPerson: 150 })],
        budgetPerPerson: 100,
      }),
      LANES,
    );
    // Without the mark, fifty over and five thousand over are the same full
    // circle — the failure that retired the previous chart.
    expect(await screen.findByText(/over target/)).toBeInTheDocument();
    expect(screen.getByText(/50% above it/)).toBeInTheDocument();
    expect(container.querySelector(".cost-donut__limit")).not.toBeNull();
  });

  it("draws no notch while the target still has headroom", async () => {
    const { container } = renderTally(worked(), LANES);
    await screen.findByText("Stay");
    expect(container.querySelector(".cost-donut__limit")).toBeNull();
    expect(container.querySelector(".cost-donut__headroom")).not.toBeNull();
  });

  it("names an option priced for part of the group instead of drawing it", async () => {
    renderTally(
      dashboard({
        memberCount: 5,
        committed: [priced(60)],
        lines: [
          locked({ perPerson: 50, effectiveHeadcount: 5 }),
          locked({
            categoryId: "cat-go",
            categoryName: "Transport",
            title: "Airport taxi",
            perPerson: 10,
            effectiveHeadcount: 3,
          }),
        ],
      }),
      LANES,
    );
    // Ten euros three of five owe cannot join a per-person total everyone is
    // measured by — so it is stated rather than folded in.
    expect(await screen.findByText("Airport taxi")).toBeInTheDocument();
    expect(screen.getByText(/for 3 members/)).toBeInTheDocument();
    expect(screen.queryByText("Transport")).toBeNull();
  });

  it("says nothing at all when no locked money is shared by the group", async () => {
    const { container } = renderTally(
      dashboard({
        memberCount: 5,
        committed: [priced(10)],
        lines: [locked({ perPerson: 10, effectiveHeadcount: 2 })],
      }),
      LANES,
    );
    await screen.findByText(/per person/);
    expect(container.querySelector(".cost-comp")).toBeNull();
  });

  it("names a currency it could not convert rather than dropping it", async () => {
    renderTally(
      dashboard({
        committed: [priced(50), priced(3000, "RSD")],
        lines: [
          locked({ perPerson: 50 }),
          locked({
            categoryId: "cat-go",
            categoryName: "Transport",
            currency: "RSD",
            perPerson: 3000,
            converted: null,
          }),
        ],
      }),
      LANES,
    );
    expect(await screen.findByText(/RSD not counted/)).toBeInTheDocument();
  });
});
