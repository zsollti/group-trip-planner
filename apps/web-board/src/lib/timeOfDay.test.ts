import { describe, expect, it } from "vitest";
import {
  fromMinutes,
  formatTimeOfDay,
  shiftTime,
  timeChoices,
  toMinutes,
  TIME_STEP_MINUTES,
} from "./timeOfDay";

/**
 * The quarter-hour time picker's arithmetic.
 *
 * The interesting cases are the two that a naive implementation gets wrong and
 * nobody notices until a real trip hits them: a span that runs past midnight,
 * and a stored time that does not sit on the grid the list offers.
 */

describe("toMinutes / fromMinutes", () => {
  it("round-trips every value the picker can offer", () => {
    for (let m = 0; m < 1440; m += TIME_STEP_MINUTES) {
      expect(toMinutes(fromMinutes(m))).toBe(m);
    }
  });

  it("rejects what isn't a time of day", () => {
    for (const bad of ["", "7:15", "24:00", "12:60", "noon", "12-30"]) {
      expect(toMinutes(bad)).toBeNull();
    }
  });
});

describe("shiftTime", () => {
  it("adds an hour", () => {
    expect(shiftTime("12:00", 60)).toBe("13:00");
    expect(shiftTime("09:45", 60)).toBe("10:45");
  });

  it("wraps past midnight rather than clamping to 23:59", () => {
    // An option can genuinely run into the next day; pinning it to the end of
    // this one would invent a different answer than the one asked for.
    expect(shiftTime("23:30", 60)).toBe("00:30");
    expect(shiftTime("00:15", -30)).toBe("23:45");
  });

  it("passes a non-time through as null, so a caller can't shift nothing", () => {
    expect(shiftTime("", 60)).toBeNull();
  });
});

describe("timeChoices", () => {
  it("offers the whole day on the quarter hour", () => {
    const choices = timeChoices("12:00");
    expect(choices).toHaveLength(1440 / TIME_STEP_MINUTES);
    expect(choices[0]).toBe("00:00");
    expect(choices.at(-1)).toBe("23:45");
  });

  it("keeps an off-grid value, in its right place", () => {
    // Anything saved by the old free-text control can sit between two steps.
    // Dropping it would round somebody's time behind their back the moment
    // they opened the form to edit an unrelated field.
    const choices = timeChoices("07:20");
    expect(choices).toContain("07:20");
    expect(choices.indexOf("07:20")).toBe(choices.indexOf("07:15") + 1);
    expect(choices.indexOf("07:30")).toBe(choices.indexOf("07:20") + 1);
  });

  it("does not duplicate a value already on the grid", () => {
    const choices = timeChoices("07:15");
    expect(choices.filter((c) => c === "07:15")).toHaveLength(1);
  });
});

describe("formatTimeOfDay", () => {
  it("labels in the reader's convention while the value stays HH:MM", () => {
    expect(formatTimeOfDay("13:00", "en-GB")).toMatch(/13:00/);
    expect(formatTimeOfDay("13:00", "en-US")).toMatch(/1:00/);
  });

  it("returns the raw value when it isn't a time", () => {
    expect(formatTimeOfDay("", "en-GB")).toBe("");
  });
});
