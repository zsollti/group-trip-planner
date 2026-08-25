import { describe, expect, it } from "vitest";
import {
  fromMinutes,
  formatTimeOfDay,
  parseTypedTime,
  sanitizeTypedTime,
  shiftTime,
  toMinutes,
} from "./timeOfDay";

/**
 * The time field's arithmetic and its parsing.
 *
 * The interesting cases are the ones a naive implementation gets wrong and
 * nobody notices until a real trip hits them: a span that runs past midnight,
 * and — now that the time is typed rather than chosen from a list — a single
 * digit after the colon, which means what it looks like and not ten times it.
 */

describe("toMinutes / fromMinutes", () => {
  it("round-trips every value the picker can offer", () => {
    for (let m = 0; m < 1440; m += 15) {
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

describe("sanitizeTypedTime", () => {
  it("keeps only what could still become a time", () => {
    expect(sanitizeTypedTime("1p9m:0x4")).toBe("19:04");
    expect(sanitizeTypedTime("19:04:33")).toBe("19:04");
  });

  it("lets a half-typed value stand", () => {
    // It runs on every keystroke, and `19:04` cannot be typed without passing
    // through all of these. Rejection happens once, on the way out.
    for (const partial of ["1", "19", "19:", "19:0"]) {
      expect(sanitizeTypedTime(partial)).toBe(partial);
    }
  });
});

describe("parseTypedTime", () => {
  it("pads a single minute digit on the left", () => {
    // The whole reason this is not `Number(m)` formatted back: `14:4` is four
    // minutes past two. Padding on the right would make it 36 minutes later
    // than what somebody typed, silently.
    expect(parseTypedTime("14:4")).toBe("14:04");
    expect(parseTypedTime("14:04")).toBe("14:04");
    expect(parseTypedTime("9:5")).toBe("09:05");
  });

  it("takes four bare digits, and three, and an hour on its own", () => {
    expect(parseTypedTime("1904")).toBe("19:04");
    expect(parseTypedTime("904")).toBe("09:04");
    expect(parseTypedTime("19")).toBe("19:00");
    expect(parseTypedTime("9")).toBe("09:00");
  });

  it("treats an empty field as a real answer", () => {
    // The dates on an option are optional and so is the time on them.
    expect(parseTypedTime("")).toBe("");
    expect(parseTypedTime("   ")).toBe("");
  });

  it("rejects rather than rounds", () => {
    // Wrapping 25:00 to 01:00, or clamping 19:70 to 19:59, would be inventing
    // an answer for someone who made a typo.
    for (const bad of ["25:00", "19:70", "24:00", "1:2:3", ":30", "19:", "x"]) {
      expect(parseTypedTime(bad)).toBeNull();
    }
  });

  it("still accepts anything the old quarter-hour list could produce", () => {
    for (let m = 0; m < 1440; m += 15) {
      const onGrid = fromMinutes(m);
      expect(parseTypedTime(onGrid)).toBe(onGrid);
    }
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
