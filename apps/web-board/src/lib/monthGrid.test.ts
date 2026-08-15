import { describe, expect, it } from "vitest";
import {
  addMonths,
  cursorFor,
  dayRole,
  isoDay,
  monthGrid,
  moveFocus,
  nextSelection,
  parseDay,
  weekdayLabels,
  within,
} from "./monthGrid";

/**
 * The range picker's arithmetic.
 *
 * The rules worth pinning are the ones a calendar gets quietly wrong: that a
 * day is a day in every timezone, that the grid is a fixed height so it does
 * not move under the pointer, that the seam between months is selectable, and
 * that a two-tap range previews what it is about to become.
 */

describe("parseDay / isoDay", () => {
  it("round-trips a day without drifting across the date line", () => {
    // The `@db.Date` trap: built with local constructors and read with local
    // getters, "2026-09-06" is the 5th anywhere west of Greenwich.
    const d = parseDay("2026-09-06");
    expect(d).not.toBeNull();
    expect(isoDay(d!)).toBe("2026-09-06");
  });

  it("rejects what is not a calendar day", () => {
    expect(parseDay("")).toBeNull();
    expect(parseDay("2026-9-6")).toBeNull();
    expect(parseDay("2026-09-06T10:00")).toBeNull();
    // Date rolls this over to 3 March rather than failing; the round-trip
    // check is what catches it.
    expect(parseDay("2026-02-31")).toBeNull();
  });
});

describe("addMonths", () => {
  it("rolls the year over in both directions", () => {
    expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({
      year: 2027,
      month: 0,
    });
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({
      year: 2025,
      month: 11,
    });
    expect(addMonths({ year: 2026, month: 5 }, -18)).toEqual({
      year: 2024,
      month: 11,
    });
  });
});

describe("cursorFor", () => {
  it("opens on the month of the day it is given", () => {
    expect(cursorFor("2026-09-06")).toEqual({ year: 2026, month: 8 });
  });
  it("falls back to the current month for a blank or bad value", () => {
    const now = new Date();
    expect(cursorFor(null)).toEqual({
      year: now.getUTCFullYear(),
      month: now.getUTCMonth(),
    });
    expect(cursorFor("nonsense")).toEqual({
      year: now.getUTCFullYear(),
      month: now.getUTCMonth(),
    });
  });
});

describe("monthGrid", () => {
  it("is always six weeks, so the grid cannot resize under the pointer", () => {
    // February 2026 starts on a Sunday and needs the most padding; a 28-day
    // February starting on a Monday needs the least. Both draw 42 cells.
    expect(monthGrid({ year: 2026, month: 1 })).toHaveLength(42);
    expect(monthGrid({ year: 2027, month: 1 })).toHaveLength(42);
    expect(monthGrid({ year: 2026, month: 8 })).toHaveLength(42);
  });

  it("starts on a Monday and pads with the neighbouring months' real days", () => {
    // 1 Sep 2026 is a Tuesday, so the grid opens on Monday 31 August.
    const grid = monthGrid({ year: 2026, month: 8 });
    expect(grid[0]).toEqual({
      iso: "2026-08-31",
      dayOfMonth: 31,
      inMonth: false,
    });
    expect(grid[1]!.iso).toBe("2026-09-01");
    expect(grid[1]!.inMonth).toBe(true);
    // Real days, not blanks: a range across the seam has to be selectable.
    const last = grid[grid.length - 1]!;
    expect(last.inMonth).toBe(false);
    expect(last.iso > "2026-09-30").toBe(true);
  });

  it("runs in unbroken calendar order across a month and a year boundary", () => {
    for (const cursor of [
      { year: 2026, month: 11 },
      { year: 2026, month: 1 },
    ]) {
      const grid = monthGrid(cursor);
      for (let i = 1; i < grid.length; i += 1) {
        const prev = parseDay(grid[i - 1]!.iso)!.getTime();
        expect(parseDay(grid[i]!.iso)!.getTime() - prev).toBe(86_400_000);
      }
    }
  });

  it("marks exactly the month's own days as in-month", () => {
    const grid = monthGrid({ year: 2026, month: 8 });
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30);
  });
});

describe("weekdayLabels", () => {
  it("gives seven labels beginning with Monday", () => {
    const labels = weekdayLabels();
    expect(labels).toHaveLength(7);
    // Locale-dependent text, so assert the day it names rather than the string.
    expect(labels[0]!.long).toBe(
      new Date(Date.UTC(2026, 0, 5)).toLocaleDateString(undefined, {
        weekday: "long",
        timeZone: "UTC",
      }),
    );
  });
});

describe("within", () => {
  it("is inclusive at both ends", () => {
    expect(within("2026-09-06", "2026-09-06", "2026-09-09")).toBe(true);
    expect(within("2026-09-09", "2026-09-06", "2026-09-09")).toBe(true);
    expect(within("2026-09-05", "2026-09-06", "2026-09-09")).toBe(false);
  });
});

describe("dayRole", () => {
  const A = "2026-09-06";
  const B = "2026-09-09";

  it("says nothing before a start is chosen", () => {
    expect(dayRole(A, null, null, null)).toBe("none");
    expect(dayRole(A, null, null, B)).toBe("none");
  });

  it("marks the ends and the days between them", () => {
    expect(dayRole(A, A, B, null)).toBe("start");
    expect(dayRole("2026-09-07", A, B, null)).toBe("between");
    expect(dayRole(B, A, B, null)).toBe("end");
    expect(dayRole("2026-09-10", A, B, null)).toBe("none");
  });

  it("previews the range under the pointer before the second tap", () => {
    // The whole point of a two-tap range: without this the second tap is a
    // guess at what is being selected.
    expect(dayRole("2026-09-07", A, null, B)).toBe("between");
    expect(dayRole(B, A, null, B)).toBe("end");
  });

  it("previews nothing for a hover before the start", () => {
    // Shading backwards would promise a range that clicking will not make —
    // an earlier click restarts the selection instead.
    expect(dayRole("2026-09-04", A, null, "2026-09-04")).toBe("none");
    expect(dayRole(A, A, null, "2026-09-04")).toBe("single");
  });

  it("calls a one-day range single, not a start with no end", () => {
    expect(dayRole(A, A, A, null)).toBe("single");
    expect(dayRole(A, A, null, null)).toBe("single");
  });
});

describe("nextSelection", () => {
  const A = "2026-09-06";
  const B = "2026-09-09";

  it("starts a range on the first tap", () => {
    expect(nextSelection(A, null, null)).toEqual({ start: A, end: null });
  });

  it("closes it on the second", () => {
    expect(nextSelection(B, A, null)).toEqual({ start: A, end: B });
  });

  it("allows a single-day range", () => {
    expect(nextSelection(A, A, null)).toEqual({ start: A, end: A });
  });

  it("restarts rather than inverting when the second tap is earlier", () => {
    expect(nextSelection("2026-09-04", A, null)).toEqual({
      start: "2026-09-04",
      end: null,
    });
  });

  it("restarts once a complete range exists", () => {
    // Editing an end the user did not say they meant is the more surprising
    // of the two behaviours.
    expect(nextSelection("2026-09-20", A, B)).toEqual({
      start: "2026-09-20",
      end: null,
    });
  });
});

describe("moveFocus", () => {
  it("steps by a day and by a week", () => {
    expect(moveFocus("2026-09-06", "ArrowRight")).toBe("2026-09-07");
    expect(moveFocus("2026-09-06", "ArrowLeft")).toBe("2026-09-05");
    expect(moveFocus("2026-09-06", "ArrowDown")).toBe("2026-09-13");
    expect(moveFocus("2026-09-06", "ArrowUp")).toBe("2026-08-30");
  });

  it("moves to the ends of the week, Monday first", () => {
    // 2026-09-06 is a Sunday, so its week runs Mon 31 Aug – Sun 6 Sep.
    expect(moveFocus("2026-09-06", "Home")).toBe("2026-08-31");
    expect(moveFocus("2026-09-06", "End")).toBe("2026-09-06");
    // 2026-09-07 is the Monday that starts the next week.
    expect(moveFocus("2026-09-07", "Home")).toBe("2026-09-07");
    expect(moveFocus("2026-09-07", "End")).toBe("2026-09-13");
  });

  it("pages by month, and clamps rather than rolling over", () => {
    expect(moveFocus("2026-09-06", "PageDown")).toBe("2026-10-06");
    expect(moveFocus("2026-09-06", "PageUp")).toBe("2026-08-06");
    // `setUTCMonth` alone would turn 31 March into 3 March, landing two months
    // from where the reader asked to go.
    expect(moveFocus("2026-03-31", "PageUp")).toBe("2026-02-28");
    expect(moveFocus("2028-03-31", "PageUp")).toBe("2028-02-29");
    expect(moveFocus("2026-01-31", "PageDown")).toBe("2026-02-28");
  });

  it("crosses month and year boundaries rather than stopping at them", () => {
    expect(moveFocus("2026-12-31", "ArrowRight")).toBe("2027-01-01");
    expect(moveFocus("2026-01-01", "ArrowLeft")).toBe("2025-12-31");
  });

  it("says nothing for a day it cannot read", () => {
    expect(moveFocus("", "ArrowRight")).toBeNull();
    expect(moveFocus("nonsense", "ArrowRight")).toBeNull();
  });
});
