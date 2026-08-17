import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CATEGORIES,
  canBeMultiSelect,
  canDeleteCategory,
  categoryOptionFields,
} from "@gtp/types";

/**
 * The built-in category seed set is pure data with no DB — this pins the shape a
 * new trip is seeded with (SRS §6 / FR-19), the single definition the
 * trip-creation transaction writes from.
 */
describe("BUILTIN_CATEGORIES", () => {
  it("seeds exactly the four documented categories, in order", () => {
    assert.deepEqual(
      BUILTIN_CATEGORIES.map((c) => c.builtinKey),
      ["DATES", "TRANSPORT", "ACCOMMODATION", "ACTIVITIES"],
    );
  });

  it("no longer seeds Budget, which double-counted into the cost total", () => {
    assert.ok(
      !BUILTIN_CATEGORIES.some((c) => c.builtinKey === "BUDGET"),
      "Budget is retired from the seed",
    );
  });

  it("seeds every built-in multi-select except Dates", () => {
    // A trip keeps several activities, several legs, sometimes several places
    // to stay. Seeding single-choice made the common case the one you had to
    // set up by hand, lane by lane, before the board could hold what the group
    // decided. Dates is not a default here but a rule — see canBeMultiSelect.
    for (const c of BUILTIN_CATEGORIES) {
      assert.equal(
        c.singleChoice,
        c.builtinKey === "DATES",
        `${c.builtinKey} seeds ${c.builtinKey === "DATES" ? "single-choice" : "multi-select"}`,
      );
    }
  });

  it("never seeds a category its own rule would refuse", () => {
    // The guard that would have caught the demo seed writing two locked
    // options into a single-choice Transport lane: a seeded multi-select
    // category must be one that is allowed to be multi-select.
    for (const c of BUILTIN_CATEGORIES) {
      if (c.singleChoice) continue;
      assert.ok(
        canBeMultiSelect({ builtinKey: c.builtinKey }),
        `${c.builtinKey} may hold several winners`,
      );
    }
  });

  it("has contiguous positions from 0 and unique keys", () => {
    assert.deepEqual(
      BUILTIN_CATEGORIES.map((c) => c.position),
      BUILTIN_CATEGORIES.map((_, i) => i),
    );
    const keys = new Set(BUILTIN_CATEGORIES.map((c) => c.builtinKey));
    assert.equal(keys.size, BUILTIN_CATEGORIES.length, "keys are unique");
  });

  it("gives every built-in a non-empty name", () => {
    for (const c of BUILTIN_CATEGORIES) {
      assert.ok(c.name.trim().length > 0, `${c.builtinKey} has a name`);
    }
  });
});

/**
 * Dates is the one undeletable category: it is the trip's only route to writing
 * back start/end dates, and `@@unique([tripId, builtinKey])` makes the loss
 * permanent. One definition, enforced by the API and read by the front-end.
 */
describe("canBeMultiSelect", () => {
  it("refuses Dates and allows every other built-in", () => {
    // The trip holds one date range, written from the one locked Dates option;
    // a second winner there would have nothing to write back to.
    assert.equal(canBeMultiSelect({ builtinKey: "DATES" }), false);
    for (const c of BUILTIN_CATEGORIES) {
      if (c.builtinKey === "DATES") continue;
      assert.equal(
        canBeMultiSelect({ builtinKey: c.builtinKey }),
        true,
        `${c.builtinKey} may hold several winners`,
      );
    }
  });

  it("allows a custom category", () => {
    assert.equal(canBeMultiSelect({ builtinKey: null }), true);
  });
});

describe("canDeleteCategory", () => {
  it("refuses Dates and allows every other built-in", () => {
    assert.equal(canDeleteCategory({ builtinKey: "DATES" }), false);
    for (const c of BUILTIN_CATEGORIES) {
      if (c.builtinKey === "DATES") continue;
      assert.equal(
        canDeleteCategory({ builtinKey: c.builtinKey }),
        true,
        `${c.builtinKey} stays deletable`,
      );
    }
  });

  it("allows custom categories (null key)", () => {
    assert.equal(canDeleteCategory({ builtinKey: null }), true);
  });
});

/** Which fields an option form offers, per category. */
describe("categoryOptionFields", () => {
  it("drops cost and link for Dates, keeps the date range", () => {
    assert.deepEqual(categoryOptionFields({ builtinKey: "DATES" }), {
      cost: false,
      url: false,
      dates: true,
      dateGranularity: "day",
    });
  });

  it("gives every other built-in and custom category the full form", () => {
    for (const key of [
      "TRANSPORT",
      "ACCOMMODATION",
      "ACTIVITIES",
      // Retired from the seed, but still parseable on older trips — so the
      // form it gets is still part of the contract.
      "BUDGET",
      null,
    ] as const) {
      assert.deepEqual(
        categoryOptionFields({ builtinKey: key }),
        { cost: true, url: true, dates: true, dateGranularity: "minute" },
        `${key ?? "custom"} keeps the full form`,
      );
    }
  });

  // The split that makes an option's dates mean something. A Dates option
  // proposes calendar days and writes back to date-only columns, where a
  // time-of-day is noise that only ever caused truncation bugs. Every other
  // category says *when within the trip*, where 07:15 is the useful part.
  it("asks Dates for days and every other category for a time of day", () => {
    assert.equal(
      categoryOptionFields({ builtinKey: "DATES" }).dateGranularity,
      "day",
    );
    for (const key of [
      "TRANSPORT",
      "ACCOMMODATION",
      "ACTIVITIES",
      null,
    ] as const)
      assert.equal(
        categoryOptionFields({ builtinKey: key }).dateGranularity,
        "minute",
        `${key ?? "custom"} captures a time of day`,
      );
  });
});
