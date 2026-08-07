import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CATEGORIES,
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

  it("pins the single-choice defaults (FR-19: Dates single, Transport multi)", () => {
    const byKey = Object.fromEntries(
      BUILTIN_CATEGORIES.map((c) => [c.builtinKey, c.singleChoice]),
    );
    assert.equal(byKey.DATES, true);
    assert.equal(byKey.TRANSPORT, false);
    assert.equal(byKey.ACCOMMODATION, true);
    assert.equal(byKey.ACTIVITIES, false);
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
        { cost: true, url: true, dates: true },
        `${key ?? "custom"} keeps the full form`,
      );
    }
  });
});
