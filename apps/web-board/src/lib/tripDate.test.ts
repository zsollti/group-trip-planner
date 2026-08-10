import { describe, expect, it } from "vitest";
import {
  calendarDayToLocalMs,
  tripDateForDisplay,
  tripDayKey,
} from "./tripDate";

/**
 * The fixture throughout is `2026-07-03T00:00:00.000Z` — a Jul 3 trip exactly
 * as the API serves it, since `Trip.startDate` is a Postgres `date` and Prisma
 * returns midnight UTC.
 *
 * Most assertions here are zone-independent by construction (UTC getters on a
 * UTC value). The one that is not — what a reader in New York sees — is pinned
 * with an explicit `timeZone` rather than by setting `TZ`, which Node ignores
 * once the process has read the OS zone.
 */

const JUL_3 = "2026-07-03T00:00:00.000Z";

describe("tripDayKey", () => {
  it("reads the day the value names, not the day the instant lands on", () => {
    expect(tripDayKey(JUL_3)).toBe("2026-07-03");
    // Robust to the older midday-UTC convention too, so it keeps working on
    // rows written before the columns settled.
    expect(tripDayKey("2026-07-03T12:00:00.000Z")).toBe("2026-07-03");
  });

  it("refuses a value it cannot parse instead of inventing a day", () => {
    expect(tripDayKey("nonsense")).toBeNull();
  });
});

describe("calendarDayToLocalMs", () => {
  it("lands inside the named day in the reader's own zone", () => {
    const ms = calendarDayToLocalMs("2026-07-03");
    expect(ms).not.toBeNull();
    const d = new Date(ms as number);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(3);
  });

  it("refuses anything that is not a calendar day", () => {
    expect(calendarDayToLocalMs("nope")).toBeNull();
    expect(calendarDayToLocalMs("2026-7-3")).toBeNull();
  });
});

describe("tripDateForDisplay", () => {
  it("shows a Jul 3 trip as Jul 3 west of Greenwich", () => {
    // The bug this exists for. Formatting the raw value renders 7/2 in every
    // American zone, because midnight UTC is the previous evening there.
    const raw = new Date(JUL_3);
    const safe = tripDateForDisplay(JUL_3) as Date;
    for (const timeZone of [
      "America/New_York",
      "America/Los_Angeles",
      "Pacific/Honolulu",
    ]) {
      expect(raw.toLocaleDateString("en-US", { timeZone })).toBe("7/2/2026");
      expect(safe.toLocaleDateString("en-US")).toBe("7/3/2026");
    }
  });

  it("passes a missing or unparseable date straight through as null", () => {
    expect(tripDateForDisplay(null)).toBeNull();
    expect(tripDateForDisplay("nonsense")).toBeNull();
  });
});
