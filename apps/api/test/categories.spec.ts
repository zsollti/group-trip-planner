import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_CATEGORIES } from "@gtp/types";

/**
 * The built-in category seed set is pure data with no DB — this pins the shape a
 * new trip is seeded with (SRS §6 / FR-19), the single definition the
 * trip-creation transaction writes from.
 */
describe("BUILTIN_CATEGORIES", () => {
  it("seeds exactly the five documented categories, in order", () => {
    assert.deepEqual(
      BUILTIN_CATEGORIES.map((c) => c.builtinKey),
      ["DATES", "TRANSPORT", "ACCOMMODATION", "ACTIVITIES", "BUDGET"],
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
    assert.equal(byKey.BUDGET, true);
  });

  it("has contiguous positions 0..4 and unique keys", () => {
    assert.deepEqual(
      BUILTIN_CATEGORIES.map((c) => c.position),
      [0, 1, 2, 3, 4],
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
