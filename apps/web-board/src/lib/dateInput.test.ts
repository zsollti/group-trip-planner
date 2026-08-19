import { describe, expect, it } from "vitest";
import {
  dayToIso,
  endDayFor,
  fromDateInput,
  isoToDayInput,
  isoToMinuteInput,
  joinDay,
  minuteToIso,
  splitDay,
  toDateInput,
} from "./dateInput";

/**
 * The two date shapes a control can speak, and the conversions between them and
 * the contract's ISO instants. The midday-UTC rule is the load-bearing one:
 * everything else here is plumbing, that one is a bug that shipped once.
 */
describe("dayToIso", () => {
  it("pins a picked day to midday UTC, not local midnight", () => {
    // Local midnight from anywhere east of Greenwich lands on the previous day
    // in UTC and gets truncated to it — the Warsaw group picks the 6th and gets
    // a trip starting the 5th. Midday has twelve hours of slack either way.
    expect(dayToIso("2026-09-06")).toBe("2026-09-06T12:00:00.000Z");
  });

  it("treats an empty control as absent rather than as an epoch date", () => {
    expect(dayToIso("")).toBeUndefined();
  });
});

describe("minuteToIso", () => {
  it("reads a local wall-clock value as an instant", () => {
    // Asserted against the runner's own zone rather than a fixed string: the
    // point is that the local value round-trips, not what UTC it lands on.
    const iso = minuteToIso("2026-09-06T07:15");
    expect(iso).toBe(new Date("2026-09-06T07:15").toISOString());
    expect(isoToMinuteInput(iso ?? null)).toBe("2026-09-06T07:15");
  });

  it("treats an empty control as absent", () => {
    expect(minuteToIso("")).toBeUndefined();
  });
});

describe("reading a stored instant back into a control", () => {
  it("shows a midday-UTC day as that same calendar day", () => {
    expect(isoToDayInput("2026-09-06T12:00:00.000Z")).toBe("2026-09-06");
  });

  it("reads a day with local getters, so an older midnight value keeps its day", () => {
    // Options proposed before the day/minute split carry whatever the old
    // datetime-local control produced — often local midnight, which is the
    // previous day in UTC. UTC getters would silently shift those back a day.
    const localMidnight = new Date("2026-09-06T00:00").toISOString();
    expect(isoToDayInput(localMidnight)).toBe("2026-09-06");
  });

  it("has no value for an absent or unparseable date", () => {
    expect(isoToDayInput(null)).toBe("");
    expect(isoToMinuteInput(null)).toBe("");
    expect(isoToDayInput("not a date")).toBe("");
    expect(isoToMinuteInput("not a date")).toBe("");
  });
});

describe("granularity dispatch", () => {
  it("routes a day field to the midday-UTC rule and a minute field to the instant", () => {
    expect(fromDateInput("2026-09-06", "day")).toBe("2026-09-06T12:00:00.000Z");
    expect(fromDateInput("2026-09-06T07:15", "minute")).toBe(
      new Date("2026-09-06T07:15").toISOString(),
    );
  });

  it("reads back at the precision the field captures", () => {
    const iso = "2026-09-06T12:00:00.000Z";
    expect(toDateInput(iso, "day")).toBe("2026-09-06");
    expect(toDateInput(iso, "minute")).toBe(isoToMinuteInput(iso));
  });
});

describe("splitting a control's value into a day and a time", () => {
  it("halves a datetime-local value", () => {
    expect(splitDay("2026-09-06T07:15")).toEqual({
      day: "2026-09-06",
      time: "07:15",
    });
  });

  it("gives a bare day an empty time rather than a wrong one", () => {
    expect(splitDay("2026-09-06")).toEqual({ day: "2026-09-06", time: "" });
    expect(splitDay("")).toEqual({ day: "", time: "" });
  });

  it("drops seconds a browser may append", () => {
    // Some browsers hand back "…T07:15:00"; the control only wants minutes.
    expect(splitDay("2026-09-06T07:15:00").time).toBe("07:15");
  });

  it("puts a day and a time back together per granularity", () => {
    expect(joinDay("2026-09-06", "07:15", "minute")).toBe("2026-09-06T07:15");
    expect(joinDay("2026-09-06", "07:15", "day")).toBe("2026-09-06");
  });

  it("defaults a day with no time to midnight, so the grid alone suffices", () => {
    // Picking two days on the calendar has to be enough. A value the form then
    // drops for want of a time half would make the picker a decoration.
    expect(joinDay("2026-09-06", "", "minute")).toBe("2026-09-06T00:00");
  });

  it("makes nothing from a time with no day", () => {
    expect(joinDay("", "07:15", "minute")).toBe("");
    expect(joinDay("", "", "day")).toBe("");
  });

  it("round-trips whatever the form last held", () => {
    for (const value of ["2026-09-06T07:15", "2026-12-31T23:59"]) {
      const { day, time } = splitDay(value);
      expect(joinDay(day, time, "minute")).toBe(value);
    }
    const { day, time } = splitDay("2026-09-06");
    expect(joinDay(day, time, "day")).toBe("2026-09-06");
  });
});

describe("endDayFor", () => {
  it("ends on the day it started, for a one-day option with an end time", () => {
    // One tap on the calendar and two times — the shape of most things a group
    // proposes. The end day is blank because there is no second date to give.
    expect(endDayFor("2026-09-06", "", "16:00", "minute")).toBe("2026-09-06");
  });

  it("leaves a real end day alone", () => {
    expect(endDayFor("2026-09-06", "2026-09-08", "16:00", "minute")).toBe(
      "2026-09-08",
    );
  });

  it("keeps the blank when the end time was cleared", () => {
    // Clearing the time is how a reader says the end is open. Falling back here
    // would join the start day to no time at all — midnight, twelve hours
    // before the option begins.
    expect(endDayFor("2026-09-06", "", "", "minute")).toBe("");
  });

  it("keeps the blank at day granularity", () => {
    // A one-day proposal genuinely has no second date; inventing one would turn
    // the day the reader picked into a range they did not.
    expect(endDayFor("2026-09-06", "", "16:00", "day")).toBe("");
  });

  it("has nothing to fall back to with no start either", () => {
    expect(endDayFor("", "", "16:00", "minute")).toBe("");
  });
});
