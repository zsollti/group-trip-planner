import { describe, expect, it } from "vitest";
import {
  dayToIso,
  fromDateInput,
  isoToDayInput,
  isoToMinuteInput,
  minuteToIso,
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
