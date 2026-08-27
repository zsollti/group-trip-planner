import { describe, expect, it } from "vitest";
import type { CategoryView, OptionView } from "@gtp/types";
import {
  buildCalendar,
  hourLabels,
  hourWindow,
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  MIN_BLOCK_MINUTES,
} from "./calendar";
import type { TimelineDay, TimelineEntry, TimelineSpan } from "./timeline";

/**
 * The week grid's arithmetic. Everything that decides *where a block lands* is
 * here, because jsdom does no layout and the browser suite is too expensive to
 * ask about every edge.
 *
 * Times are built from local `Date` values rather than fixed epoch numbers —
 * the layout is deliberately local (a day column is a local day), so pinning
 * UTC instants would make these pass or fail on the runner's zone.
 */

const category = { id: "c1", name: "Activities" } as CategoryView;

/** Local midnight, `d` days from an arbitrary fixed date. */
function dayStart(d: number): number {
  const at = new Date(2026, 8, 10 + d, 0, 0, 0, 0);
  return at.getTime();
}

function at(d: number, hour: number, minute = 0): number {
  return dayStart(d) + (hour * 60 + minute) * 60_000;
}

function entry(
  id: string,
  d: number,
  from: [number, number],
  to?: [number, number],
): TimelineEntry {
  const start = at(d, from[0], from[1]);
  return {
    kind: "option",
    id,
    title: id,
    option: { id, title: id } as OptionView,
    category,
    start,
    end: to ? at(d, to[0], to[1]) : start,
    isPoint: !to,
  };
}

function day(d: number, entries: TimelineEntry[]): TimelineDay {
  return {
    key: `d${d}`,
    at: dayStart(d),
    outsideTrip: false,
    entries,
  };
}

/**
 * A multi-day stay. `hours` is the wall clock it actually runs between — a real
 * booking is `{ from: 15, to: 10 }`, checked in on the first afternoon and out
 * on the last morning. Omitted, it covers its days end to end, which is what
 * every bar used to be assumed to do.
 */
function span(
  id: string,
  firstDay: string,
  lastDay: string,
  hours?: { from: number; to: number },
): TimelineSpan {
  const fromIdx = Number(firstDay.replace(/^d/, ""));
  const toIdx = Number(lastDay.replace(/^d/, ""));
  const start = Number.isNaN(fromIdx) ? 0 : at(fromIdx, hours?.from ?? 0);
  const end = Number.isNaN(toIdx)
    ? 0
    : hours
      ? at(toIdx, hours.to)
      : dayStart(toIdx + 1);
  return {
    kind: "option",
    id,
    title: id,
    option: { id, title: id } as OptionView,
    category,
    start,
    end,
    isPoint: false,
    firstDay,
    lastDay,
    nights: Math.max(
      1,
      (Number.isNaN(toIdx) ? 0 : toIdx) - (Number.isNaN(fromIdx) ? 0 : fromIdx),
    ),
  };
}

describe("hourWindow", () => {
  it("shows the waking day when nothing falls outside it", () => {
    const w = hourWindow([day(0, [entry("a", 0, [10, 0], [12, 0])])]);
    expect(w).toEqual({
      startHour: DEFAULT_START_HOUR,
      endHour: DEFAULT_END_HOUR,
    });
  });

  it("widens up to reach an early start, never cropping it", () => {
    // A 07:15 flight is exactly the case a fixed 08:00 grid would hide.
    const w = hourWindow([day(0, [entry("a", 0, [7, 15], [9, 40])])]);
    expect(w.startHour).toBe(7);
  });

  it("widens down to contain a late finish", () => {
    const w = hourWindow([day(0, [entry("a", 0, [20, 0], [22, 30])])]);
    expect(w.endHour).toBe(23);
  });

  it("never narrows below the default window", () => {
    const w = hourWindow([day(0, [entry("a", 0, [12, 0], [13, 0])])]);
    expect(w.startHour).toBeLessThanOrEqual(DEFAULT_START_HOUR);
    expect(w.endHour).toBeGreaterThanOrEqual(DEFAULT_END_HOUR);
  });

  it("makes room for a point that would otherwise sit on the edge", () => {
    // A 23:50 moment has no end; it still needs its minimum block drawn.
    const w = hourWindow([day(0, [entry("a", 0, [23, 50])])]);
    expect(w.endHour).toBe(24);
  });

  it("stays inside a real day", () => {
    const w = hourWindow([
      day(0, [entry("a", 0, [0, 0], [1, 0]), entry("b", 0, [23, 0])]),
    ]);
    expect(w.startHour).toBe(0);
    expect(w.endHour).toBe(24);
  });
});

describe("buildCalendar placement", () => {
  it("puts a block at its own time, measured from the grid's first hour", () => {
    const grid = buildCalendar([day(0, [entry("a", 0, [10, 0], [12, 0])])], []);
    const [p] = grid.days[0]!.placements;
    // 10:00 with an 08:00 grid start = two hours down.
    expect(p!.topMinutes).toBe(120);
    expect(p!.heightMinutes).toBe(120);
  });

  it("makes height mean duration", () => {
    const grid = buildCalendar(
      [
        day(0, [
          entry("short", 0, [10, 0], [11, 0]),
          entry("long", 0, [13, 0], [17, 0]),
        ]),
      ],
      [],
    );
    const byId = new Map(grid.days[0]!.placements.map((p) => [p.entry.id, p]));
    expect(byId.get("long")!.heightMinutes).toBe(
      byId.get("short")!.heightMinutes * 4,
    );
  });

  it("gives a moment with no duration a block you can still hit", () => {
    const grid = buildCalendar([day(0, [entry("a", 0, [10, 0])])], []);
    expect(grid.days[0]!.placements[0]!.heightMinutes).toBe(MIN_BLOCK_MINUTES);
  });

  it("leaves a clear day one full-width column", () => {
    const grid = buildCalendar(
      [
        day(0, [
          entry("a", 0, [9, 0], [10, 0]),
          entry("b", 0, [11, 0], [12, 0]),
        ]),
      ],
      [],
    );
    for (const p of grid.days[0]!.placements) {
      expect(p.laneCount).toBe(1);
      expect(p.lane).toBe(0);
    }
  });

  it("sets two things booked at once side by side", () => {
    // Drawn on top of each other, one would be invisible — a page lying by
    // omission, which is worse than the list it replaced.
    const grid = buildCalendar(
      [
        day(0, [
          entry("a", 0, [10, 0], [12, 0]),
          entry("b", 0, [11, 0], [13, 0]),
        ]),
      ],
      [],
    );
    const lanes = grid.days[0]!.placements.map((p) => p.lane).sort();
    expect(lanes).toEqual([0, 1]);
    for (const p of grid.days[0]!.placements) expect(p.laneCount).toBe(2);
  });

  it("keeps a clash from narrowing the rest of the day", () => {
    // `laneCount` is per overlapping group: one double-booked breakfast should
    // not halve the width of a clear afternoon.
    const grid = buildCalendar(
      [
        day(0, [
          entry("a", 0, [9, 0], [10, 0]),
          entry("b", 0, [9, 30], [10, 30]),
          entry("afternoon", 0, [15, 0], [16, 0]),
        ]),
      ],
      [],
    );
    const byId = new Map(grid.days[0]!.placements.map((p) => [p.entry.id, p]));
    expect(byId.get("a")!.laneCount).toBe(2);
    expect(byId.get("afternoon")!.laneCount).toBe(1);
  });

  it("treats back-to-back bookings as sequential, not overlapping", () => {
    // A checkout at 10:00 and a tour at 10:00 are adjacent. They are only far
    // enough apart to be sequential once the minimum block has passed.
    const grid = buildCalendar(
      [
        day(0, [
          entry("first", 0, [9, 0], [10, 0]),
          entry("second", 0, [10, 0], [11, 0]),
        ]),
      ],
      [],
    );
    for (const p of grid.days[0]!.placements) expect(p.laneCount).toBe(1);
  });
});

describe("buildCalendar bands", () => {
  const days = [day(0, []), day(1, []), day(2, []), day(3, [])].map((d, i) => ({
    ...d,
    key: `d${i}`,
  }));

  it("spans a bar across exactly the columns it covers", () => {
    const grid = buildCalendar(days, [span("hotel", "d0", "d2")]);
    const [b] = grid.bands;
    expect(b!.fromIndex).toBe(0);
    expect(b!.toIndex).toBe(2);
  });

  it("stacks two overlapping stays so neither is hidden", () => {
    const grid = buildCalendar(days, [
      span("hotel", "d0", "d2"),
      span("car", "d1", "d3"),
    ]);
    const rows = grid.bands.map((b) => b.row).sort();
    expect(rows).toEqual([0, 1]);
    expect(grid.bandRows).toBe(2);
  });

  it("reuses a row once a bar has finished", () => {
    const grid = buildCalendar(days, [
      span("first", "d0", "d1"),
      span("second", "d2", "d3"),
    ]);
    expect(grid.bandRows).toBe(1);
  });

  it("needs no band at all when the trip has no spans", () => {
    expect(buildCalendar(days, []).bandRows).toBe(0);
  });

  it("clamps a bar whose day is not on the axis", () => {
    // The spine's gutter guards this too: an unclamped -1 places the bar at
    // column 0 and misaligns every bar after it.
    const grid = buildCalendar(days, [span("stray", "nope", "also-nope")]);
    expect(grid.bands[0]!.fromIndex).toBe(0);
    expect(grid.bands[0]!.toIndex).toBeGreaterThanOrEqual(0);
  });
});

/**
 * How much of its columns a bar actually covers.
 *
 * The bar used to fill every column it touched, which made the calendar state
 * something false at both ends: a flat booked to 10:00 on the last day painted
 * that whole day, so the grid showed a bed for a night nobody had booked — the
 * exact gap the "no bed booked" heading exists to warn about, hidden by the bar
 * that caused it.
 */
describe("buildCalendar bar extent", () => {
  const days = [day(0, []), day(1, []), day(2, []), day(3, [])].map((d, i) => ({
    ...d,
    key: `d${i}`,
  }));

  it("fills its columns when the stay covers all of them", () => {
    const [b] = buildCalendar(days, [span("hotel", "d0", "d3")]).bands;
    expect(b!.leadFraction).toBe(0);
    expect(b!.widthFraction).toBe(1);
  });

  it("checks in on the first afternoon and out on the last morning", () => {
    // Fri 15:00 → Mon 10:00 over four columns. It should begin a little under a
    // sixth of the way in and stop well short of the far edge.
    const [b] = buildCalendar(days, [
      span("flat", "d0", "d3", { from: 15, to: 10 }),
    ]).bands;
    expect(b!.leadFraction).toBeCloseTo(15 / 24 / 4, 5);
    expect(b!.widthFraction).toBeCloseTo((3 - 15 / 24 + 10 / 24) / 4, 5);
    // The far edge of the bar lands inside the last column, not past it.
    expect(b!.leadFraction + b!.widthFraction).toBeLessThan(1);
    expect(b!.leadFraction + b!.widthFraction).toBeGreaterThan(3 / 4);
  });

  it("never shrinks a short overnight to nothing", () => {
    // 22:00 → 02:00 covers almost none of the two columns it touches, and a
    // decision that is honestly invisible has fallen off the calendar.
    const [b] = buildCalendar(days, [
      span("ferry", "d0", "d1", { from: 22, to: 2 }),
    ]).bands;
    expect(b!.widthFraction).toBeGreaterThan(0);
    expect(b!.leadFraction + b!.widthFraction).toBeLessThanOrEqual(1);
  });

  it("begins at the edge when the stay starts before the grid does", () => {
    // The clamp puts it in column 0, but it did not start there — so there is
    // no partial first day to draw, and pretending otherwise would shift the
    // bar off the day it is actually covering.
    const [b] = buildCalendar(days, [span("early", "before", "d1")]).bands;
    expect(b!.fromIndex).toBe(0);
    expect(b!.leadFraction).toBe(0);
  });

  it("keeps every bar inside the columns it was given", () => {
    const bands = buildCalendar(days, [
      span("a", "d0", "d1", { from: 23, to: 1 }),
      span("b", "d0", "d3", { from: 15, to: 10 }),
      span("c", "d2", "d3"),
    ]).bands;
    for (const b of bands) {
      expect(b.leadFraction).toBeGreaterThanOrEqual(0);
      expect(b.leadFraction + b.widthFraction).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("hourLabels", () => {
  it("labels every hour row the grid draws", () => {
    const grid = buildCalendar([day(0, [])], []);
    const labels = hourLabels(grid);
    expect(labels[0]).toBe(grid.startHour);
    expect(labels).toHaveLength(grid.endHour - grid.startHour);
    expect(labels.at(-1)).toBe(grid.endHour - 1);
  });
});
