import { describe, expect, it } from "vitest";
import { CategoryBuiltinKey } from "@gtp/types";
import {
  categoryHue,
  categoryHueStyle,
  categoryIconKey,
} from "./categoryTheme";

const custom = (id: string) => ({ id, builtinKey: null });
const BUILTIN_KEYS = CategoryBuiltinKey.options;

describe("categoryHue", () => {
  it("pins a built-in to its key, not its id", () => {
    // The whole point of `builtinKey`: a renamed, reordered, re-seeded Dates
    // lane in another trip is still the same colour.
    const here = { id: "aaaa", builtinKey: "DATES" as const };
    const there = { id: "bbbb", builtinKey: "DATES" as const };
    expect(categoryHue(here)).toBe(categoryHue(there));
  });

  it("gives each built-in a different hue", () => {
    const hues = BUILTIN_KEYS.map((builtinKey) =>
      categoryHue({ id: "x", builtinKey }),
    );
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("keeps the lanes a reader compares far apart on the wheel", () => {
    // Seeded order is the order they appear in the row, so neighbours are what
    // actually get confused. Two blues 40° apart in the first two lanes was the
    // weak spot the rendered board exposed; 90° is comfortably above it.
    const seeded = [
      "DATES",
      "TRANSPORT",
      "ACCOMMODATION",
      "ACTIVITIES",
    ] as const;
    for (let i = 1; i < seeded.length; i += 1) {
      const a = categoryHue({ id: "x", builtinKey: seeded[i - 1]! });
      const b = categoryHue({ id: "x", builtinKey: seeded[i]! });
      const apart = Math.abs(a - b);
      expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(90);
    }
  });

  it("is total over the enum, including retired Budget", () => {
    // A pre-retirement trip still has a Budget row. A missing entry here would
    // render that lane with `--cat-hue: undefined` and no colour at all.
    for (const builtinKey of BUILTIN_KEYS) {
      const hue = categoryHue({ id: "x", builtinKey });
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("is deterministic for a custom category", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(categoryHue(custom(id))).toBe(categoryHue(custom(id)));
  });

  it("never gives a custom category a seeded lane's colour", () => {
    // Except gold, which retired Budget shares on purpose — a legacy lane
    // matching a custom one is a cosmetic tie, not a mixed signal.
    const seeded = new Set(
      BUILTIN_KEYS.filter((k) => k !== "BUDGET").map((builtinKey) =>
        categoryHue({ id: "x", builtinKey }),
      ),
    );
    for (let i = 0; i < 200; i += 1) {
      expect(seeded.has(categoryHue(custom(`custom-${i}`)))).toBe(false);
    }
  });

  it("keeps every hue clear of the danger and accent bands", () => {
    // A lane that reads as an error, or as the app's own accent, is worse than
    // a lane with no colour. 0–15 is `--board-danger`, 160–190 `--board-accent`.
    const all = [
      ...BUILTIN_KEYS.map((builtinKey) => categoryHue({ id: "x", builtinKey })),
      ...Array.from({ length: 200 }, (_, i) => categoryHue(custom(`c-${i}`))),
    ];
    for (const hue of all) {
      expect(hue).toBeGreaterThan(15);
      expect(hue < 160 || hue > 190).toBe(true);
    }
  });

  it("spreads custom categories across the ring", () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => categoryHue(custom(`c-${i}`))),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("categoryIconKey", () => {
  it("marks a built-in with its own key", () => {
    expect(categoryIconKey({ builtinKey: "TRANSPORT" })).toBe("TRANSPORT");
  });

  it("gives every custom category the same mark", () => {
    expect(categoryIconKey({ builtinKey: null })).toBe("CUSTOM");
  });
});

describe("categoryHueStyle", () => {
  it("carries the hue as a bare number for CSS to interpret", () => {
    // A number, not a colour: light and dark pick their own lightness from it.
    expect(categoryHueStyle({ id: "x", builtinKey: "DATES" })).toEqual({
      "--cat-hue": "320",
    });
  });
});
