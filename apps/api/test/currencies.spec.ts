import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COMMON_CURRENCY_CODES,
  CURRENCIES,
  currencyChoices,
  currencyName,
  currencySchema,
} from "@gtp/types";

/**
 * The currency list is pure data with no DB. What matters about it is the
 * relationship to `currencySchema`: the list is a convenience for a picker, the
 * schema is what the server accepts, and they are deliberately not the same set.
 */
describe("CURRENCIES", () => {
  it("holds only codes the schema would accept", () => {
    for (const c of CURRENCIES) {
      assert.equal(currencySchema.parse(c.code), c.code);
    }
  });

  it("has no duplicates and names everything", () => {
    const codes = CURRENCIES.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of CURRENCIES) assert.ok(c.name.length > 0);
  });

  it("is sorted by code, so a picker is scannable", () => {
    const codes = CURRENCIES.map((c) => c.code);
    assert.deepEqual(codes, [...codes].sort());
  });

  it("knows every code it promotes to the top of the picker", () => {
    for (const code of COMMON_CURRENCY_CODES) {
      assert.ok(currencyName(code), `${code} is promoted but not listed`);
    }
  });
});

describe("currencySchema is wider than the list", () => {
  it("still accepts a code nobody thought to add", () => {
    // The whole reason the list is not an enum: a trip denominated in something
    // unlisted should be an unusual choice, not a 400.
    assert.equal(currencySchema.parse("zwl"), "ZWL");
    assert.ok(!CURRENCIES.some((c) => c.code === "ZWL"));
  });

  it("still rejects what is not a currency code", () => {
    assert.throws(() => currencySchema.parse("EURO"));
    assert.throws(() => currencySchema.parse("E1R"));
  });
});

describe("currencyChoices", () => {
  it("puts the common codes first and lists the rest once", () => {
    const { common, rest } = currencyChoices("EUR");
    assert.deepEqual(
      common.map((c) => c.code),
      [...COMMON_CURRENCY_CODES],
    );
    for (const c of rest) {
      assert.ok(!COMMON_CURRENCY_CODES.includes(c.code));
    }
    assert.equal(common.length + rest.length, CURRENCIES.length);
  });

  it("keeps an unlisted current value as a real option", () => {
    // A `<select>` whose value is not among its options renders blank and
    // rewrites the field on the next save — which is how an edit form quietly
    // changes a trip's currency.
    const { common } = currencyChoices("ZWL");
    assert.equal(common[0]?.code, "ZWL");
  });

  it("does not duplicate a current value that is already listed", () => {
    const { common, rest } = currencyChoices("HUF");
    const all = [...common, ...rest].filter((c) => c.code === "HUF");
    assert.equal(all.length, 1);
  });

  it("is fine with no current value at all", () => {
    const { common } = currencyChoices();
    assert.deepEqual(
      common.map((c) => c.code),
      [...COMMON_CURRENCY_CODES],
    );
  });
});
