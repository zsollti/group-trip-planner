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
  const base = {
    tripId: "t1",
    defaultCurrency: "EUR",
    budgetPerPerson: null,
    memberCount: 4,
    committed: [],
    projected: [],
    lines: [],
    converted: null,
    generatedAt: new Date().toISOString(),
    ...over,
  };
  return {
    ...base,
    // Everyone shares everything unless a case says otherwise — the reader's
    // own share is then the trip's, which is what it was before opt-in options
    // existed and what almost every trip still looks like.
    viewerCommitted: over.viewerCommitted ?? base.committed,
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
    // The reader is in for all of it by default, as above.
    viewer: { group, perPerson, converted: [currency], missing },
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
      <CostTally tripId="t1" myUserId="u-me" />
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

  /**
   * The target against **your** money, not the trip's.
   *
   * The bug this fixes, in the reporter's own numbers: a €100 target, €98 of
   * shared options, and a €4 thing two of five people joined. The trip's
   * per-person total adds every option's per-head cost, so it read €102 and
   * warned all five — including the three who declined to spend the €4.
   */
  it("reads the target against the viewer's own share, not the trip's", async () => {
    renderTally(
      dashboard({
        budgetPerPerson: 100,
        committed: [priced(102)],
        // What this reader is actually in for: the shared 98, not the extra 4.
        viewerCommitted: [priced(98)],
      }),
    );
    const verdict = await screen.findByText(/to spare/);
    // Under, by the two the shared options leave them.
    expect(digits(verdict.textContent)).toContain("2");
    expect(screen.queryByText(/over/)).toBeNull();
    // And it says whose figure it is, since the two genuinely differ here.
    expect(verdict.textContent).toMatch(/yours/i);
  });

  it("still warns the members who really are over", async () => {
    renderTally(
      dashboard({
        budgetPerPerson: 100,
        committed: [priced(102)],
        // This reader joined the opt-in option, so it is their money.
        viewerCommitted: [priced(102)],
      }),
    );
    expect(await screen.findByText(/over/)).toBeInTheDocument();
  });

  it("does not say 'yours' when everything is shared", async () => {
    // On a trip with no opt-in options the two figures are the same, and the
    // word would imply a distinction that does not exist.
    renderTally(dashboard({ budgetPerPerson: 100, committed: [priced(98)] }));
    const verdict = await screen.findByText(/to spare/);
    expect(verdict.textContent).not.toMatch(/yours/i);
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

  it("states a locked-but-costless trip once, in the trip's own currency", async () => {
    // The bug this pins: a trip whose only decision was its dates. The seeded
    // Dates option is unpriced and used to be stored as EUR whatever currency
    // the trip was in, and the engine aggregated it anyway — so a dollar trip
    // got a zero-EUR subtotal, and the strip printed "0 EUR" as a total, "0 EUR
    // per person" beside it, and then drew "0 USD" in the ring below. Three
    // figures for no money, two of them in a currency the trip does not use.
    //
    // The engine no longer aggregates unpriced options, so this state should be
    // unreachable from that route — but a locked option priced at *zero* still
    // produces a real subtotal of nothing, and it must read the same way.
    renderTally(
      dashboard({
        defaultCurrency: "USD",
        committed: [{ currency: "EUR", group: 0, perPerson: 0 }],
        lines: [locked({ perPerson: 0, group: 0 })],
      }),
    );

    expect(
      await screen.findByText(/Lock a priced option to start the tally/),
    ).toBeInTheDocument();
    // The ring's own caption, which is the *only* "per person" left — the
    // headline's separate restatement of the same zero is gone. Two matches at
    // most, both belonging to the ring: its figure and its label.
    expect(screen.queryByText(/per person/)).toBeInTheDocument();
    expect(screen.getAllByText(/0/).length).toBeLessThanOrEqual(2);
    // And nothing anywhere claims a currency the trip is not denominated in.
    expect(document.body.textContent).not.toMatch(/EUR|€/);
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
    expect(row?.querySelector(".cost-comp__amount")?.textContent).toContain(
      "15",
    );
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
    const hues = [...container.querySelectorAll(".cost-donut__wedge")].map(
      (w) => (w as SVGElement).style.getPropertyValue("--cat-hue"),
    );
    // Accommodation is amber (25) and leads on size; transport is sky (200).
    expect(hues[0]).toBe("25");
    expect(hues).toContain("200");
  });

  it("draws the ring, and offers no shape to swap it for", async () => {
    // The composition shipped as a donut *or* a stacked bar behind a segmented
    // control. One surface with two drawings of one model turned out to be a
    // question nobody had, so the bar and its toggle were removed. The legend
    // is the part that never depended on either — it is the model, not the
    // chart — and it still names every lane.
    const { container } = renderTally(worked(), LANES);
    await screen.findByText("Stay");
    expect(container.querySelector(".cost-donut")).not.toBeNull();

    expect(screen.queryByRole("button", { name: "Bar" })).toBeNull();
    expect(screen.queryByRole("group", { name: /chart shape/i })).toBeNull();
    expect(container.querySelector(".tally-bar__seg--cat")).toBeNull();
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
    //
    // Both figures are on the breakdown's own row now. They used to be a
    // sentence under the list as well, saying the same two numbers a second
    // time in prose; the row is where a reader is already reading figures.
    const row = (await screen.findByText("Over budget")).closest("li")!;
    // The percentage is of the *target* — how far past it the trip went — and
    // the amount is the money. Both scoped to the row, and asserted by their
    // own classes rather than by matching "50" twice in a row that says it
    // twice for two different reasons.
    expect(row.querySelector(".cost-comp__share")!.textContent).toMatch(
      /50\s*%/,
    );
    expect(row.querySelector(".cost-comp__amount")!.textContent).toMatch(/50/);
    expect(container.querySelector(".cost-donut__over")).not.toBeNull();
    // The band is the whole mark. It used to start with a short radial tick at
    // the same angle, which drew the boundary the band's own end already draws
    // — a clean red line with one stray stroke sticking out of it.
    expect(container.querySelector(".cost-donut__limit")).toBeNull();
  });

  it("draws no notch while the target still has headroom", async () => {
    const { container } = renderTally(worked(), LANES);
    await screen.findByText("Stay");
    expect(container.querySelector(".cost-donut__over")).toBeNull();
    expect(container.querySelector(".cost-donut__headroom")).not.toBeNull();
  });

  /**
   * The overshoot, read like any other part of the circle.
   *
   * It was the last mark on this chart that did nothing under the pointer, and
   * the only one whose figure the hole never printed — so "how far over are we"
   * was a question the drawing raised and left to the list to answer.
   */
  it("reads the overshoot in the middle of the ring when pointed at", async () => {
    const { container } = renderTally(
      dashboard({
        committed: [priced(150)],
        lines: [locked({ perPerson: 150 })],
        budgetPerPerson: 100,
      }),
      LANES,
    );
    await screen.findByText("Over budget");
    const band = container.querySelector(".cost-donut__over")!;
    fireEvent.mouseEnter(band);

    // The lift and the dim, the same pair every other part of the ring uses.
    // `getAttribute`, not `className`: on an SVG element that property is an
    // `SVGAnimatedString`, not a string.
    expect(band.getAttribute("class")).toContain("cost-donut__over--on");
    expect(container.querySelector(".cost-donut__wedge--off")).not.toBeNull();
    // And the figure, in the hole, where the reader is already looking.
    const centre = container.querySelector(".cost-donut__centre")!;
    expect(centre.textContent).toContain("Over budget");
    expect(centre.textContent).toMatch(/50/);
    expect(centre.querySelector(".cost-donut__figure--over")).not.toBeNull();
  });

  /**
   * Which way the red goes, and how far out it sits.
   *
   * Both are read off the attributes rather than a screenshot, because both are
   * arithmetic: an SVG circle's dash starts at three o'clock and the ring is
   * rotated a quarter-turn, so a dash **offset of zero is twelve o'clock going
   * clockwise** — the direction every wedge under it runs. The band used to
   * carry a negative offset, which put its *end* at twelve and grew it
   * backwards: the one mark on the chart the eye had to read anticlockwise.
   */
  it("starts the overshoot at twelve and runs it clockwise, like the wedges", async () => {
    const { container } = renderTally(
      dashboard({
        committed: [priced(150)],
        lines: [locked({ perPerson: 150 })],
        budgetPerPerson: 100,
      }),
      LANES,
    );
    await screen.findByText("Over budget");
    const band = container.querySelector(".cost-donut__over")!;
    // No offset at all, or an explicit zero — either is "starts at the top".
    const offset = band.getAttribute("stroke-dashoffset");
    expect(offset === null || Number(offset) === 0).toBe(true);

    // And it is a third of its own circle: 50 over a 100 target is 50 of the
    // 150 the ring is scaled to. A band drawn the other way would be the same
    // length, so the offset above is what actually distinguishes them — this
    // guards the length from following it.
    const [drawn, circumference] = band
      .getAttribute("stroke-dasharray")!
      .split(" ")
      .map(Number);
    expect(drawn! / circumference!).toBeCloseTo(1 / 3, 2);
  });

  it("grows the overshoot band outwards by a wedge's lift", async () => {
    // Two things at once, and they are one thing: the band gains as much as any
    // other part gains when it is read (it used to gain less than half), and it
    // gains it *outwards*, so the gap between it and the wedges it measures is
    // the same before and after. A stroke thickens about its centreline, so
    // without moving the radius the wedge-sized lift would close that gap.
    const { container } = renderTally(
      dashboard({
        committed: [priced(150)],
        lines: [locked({ perPerson: 150 })],
        budgetPerPerson: 100,
      }),
      LANES,
    );
    await screen.findByText("Over budget");
    const band = container.querySelector(".cost-donut__over")!;
    const edge = () =>
      Number(band.getAttribute("r")) -
      Number(band.getAttribute("stroke-width")) / 2;
    const rest = {
      inner: edge(),
      width: Number(band.getAttribute("stroke-width")),
    };

    fireEvent.mouseEnter(band);
    const lifted = {
      inner: edge(),
      width: Number(band.getAttribute("stroke-width")),
    };

    // A wedge's own lift, taken from the wedge beside it rather than restated.
    const wedge = container.querySelector(".cost-donut__wedge")!;
    const wedgeRest = Number(wedge.getAttribute("stroke-width"));
    fireEvent.mouseEnter(wedge);
    const wedgeLift = Number(wedge.getAttribute("stroke-width")) - wedgeRest;

    expect(lifted.width - rest.width).toBe(wedgeLift);
    expect(lifted.inner).toBeCloseTo(rest.inner, 5);
  });

  it("gives the overshoot row the keyboard's way into that band", async () => {
    // The ring is `aria-hidden` decoration, so a part of it that can only be
    // reached by pointing cannot be reached at all. Every other row is a
    // button; this one was a div, correctly, while the band was inert.
    const { container } = renderTally(
      dashboard({
        committed: [priced(150)],
        lines: [locked({ perPerson: 150 })],
        budgetPerPerson: 100,
      }),
      LANES,
    );
    const row = (await screen.findByText("Over budget")).closest("li")!;
    const button = row.querySelector("button")!;
    expect(button).not.toBeNull();

    fireEvent.focus(button);
    expect(container.querySelector(".cost-donut__over--on")).not.toBeNull();
    expect(row.className).toContain("cost-comp__row--on");
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
            participants: [
              {
                userId: "u-me",
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
      LANES,
    );
    // Ten euros three of five owe cannot join a per-person total everyone is
    // measured by — so it is stated rather than folded in.
    expect(await screen.findByText("Airport taxi")).toBeInTheDocument();
    expect(screen.queryByText("Transport")).toBeNull();
    // Who, not how many. The line used to read "for 3 members"; the question a
    // reader has in front of an option priced for part of the group is which
    // part, and whether they are in it.
    expect(screen.queryByText(/for 3 members/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /3 in — see who/ }),
    ).toBeInTheDocument();

    // And the ring still says plainly what its figure is. It used to switch to
    // "per person, shared" whenever something was held back — a qualifier
    // printed in the hole, three lines above the aside that explains it, where
    // a reader meets it before there is anything to share. What the figure *is*
    // belongs under the figure; what is missing from it belongs in the aside.
    // Scoped to the hole: the aside underneath prices its held-back option "per
    // person" too, which is the same words about a different figure.
    expect(document.querySelector(".cost-donut__caption")!.textContent).toBe(
      "per person",
    );
    expect(screen.queryByText(/shared/)).toBeNull();
  });

  it("rings the reader's own face among the people an option is priced for", async () => {
    // It replaces a "· yours" that followed the number. Same fact, said where
    // the eye already is.
    const { container } = renderTally(
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
            effectiveHeadcount: 2,
            viewerOwes: true,
            participants: [
              {
                userId: "u-me",
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
            ],
          }),
        ],
      }),
      LANES,
    );
    await screen.findByText("Airport taxi");
    expect(container.querySelectorAll(".lane__voter--mine")).toHaveLength(1);
  });

  it("rings nobody when the reader is not one of them", async () => {
    const { container } = renderTally(
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
            effectiveHeadcount: 2,
            viewerOwes: false,
            participants: [
              {
                userId: "u-2",
                displayName: "Grace",
                avatarUrl: null,
                joinedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        ],
      }),
      LANES,
    );
    await screen.findByText("Airport taxi");
    expect(container.querySelectorAll(".lane__voter--mine")).toHaveLength(0);
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
