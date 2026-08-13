import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertAmount, convertSubtotals, crossRate } from "@gtp/types";

/**
 * The approximate-conversion core (post-launch) — pure, no DB, no fetch, no
 * clock. What is worth exhausting here is everything that decides whether a
 * figure is *offered at all*: an unknown rate, a zero rate, a destination
 * nobody publishes, and the pivot's own special case.
 *
 * Rates below are "units per one EUR", the shape the reference source
 * publishes and the table stores.
 */

const RATES = { HUF: 400, USD: 1.1, GBP: 0.85 } as const;

describe("crossRate", () => {
  it("is 1 for a currency against itself, rate or no rate", () => {
    assert.equal(crossRate("EUR", "EUR", RATES), 1);
    assert.equal(crossRate("HUF", "HUF", RATES), 1);
    // Nothing is published for Serbian dinar, and it still equals itself.
    assert.equal(crossRate("RSD", "RSD", RATES), 1);
  });

  it("reads the pivot as 1 without storing it", () => {
    assert.equal(crossRate("EUR", "HUF", RATES), 400);
    assert.equal(crossRate("HUF", "EUR", RATES), 1 / 400);
  });

  it("crosses two non-pivot currencies through the pivot", () => {
    // 1 USD = (1/1.1) EUR = 400/1.1 HUF.
    assert.ok(Math.abs(crossRate("USD", "HUF", RATES)! - 400 / 1.1) < 1e-9);
  });

  it("round-trips back to where it started", () => {
    const there = crossRate("GBP", "HUF", RATES)!;
    const back = crossRate("HUF", "GBP", RATES)!;
    assert.ok(Math.abs(there * back - 1) < 1e-9);
  });

  it("has no rate when either side is unpublished", () => {
    assert.equal(crossRate("RSD", "EUR", RATES), null);
    assert.equal(crossRate("EUR", "RSD", RATES), null);
  });

  it("refuses a zero or nonsense rate instead of converting to nothing", () => {
    // The dangerous one: a zero passes an "is it there" check and then turns
    // every amount in that currency into 0 — which reads as "this is free"
    // rather than "this could not be converted".
    const broken = { ZWL: 0, XXX: Number.NaN, YYY: -3 };
    assert.equal(crossRate("ZWL", "EUR", broken), null);
    assert.equal(crossRate("XXX", "EUR", broken), null);
    assert.equal(crossRate("YYY", "EUR", broken), null);
  });
});

describe("convertAmount", () => {
  it("converts through the pivot", () => {
    assert.equal(convertAmount(10, "EUR", "HUF", RATES), 4000);
    assert.equal(convertAmount(4000, "HUF", "EUR", RATES), 10);
  });

  it("returns null rather than a wrong number", () => {
    assert.equal(convertAmount(10, "RSD", "EUR", RATES), null);
  });
});

describe("convertSubtotals", () => {
  const sub = (currency: string, group: number, perPerson: number) => ({
    currency,
    group,
    perPerson,
  });

  it("folds several currencies into one approximate total", () => {
    const out = convertSubtotals(
      [sub("EUR", 300, 75), sub("HUF", 400_000, 100_000)],
      "EUR",
      RATES,
    )!;
    // 400,000 HUF is 1,000 EUR on these rates, so 1,300 in total.
    assert.equal(out.group, 1300);
    assert.equal(out.perPerson, 75 + 250);
    assert.deepEqual([...out.converted], ["EUR", "HUF"]);
    assert.deepEqual([...out.missing], []);
  });

  it("converts into the trip's own currency, not the pivot", () => {
    const out = convertSubtotals([sub("EUR", 300, 75)], "HUF", RATES)!;
    assert.equal(out.group, 120_000);
  });

  it("names what it had to leave out instead of quietly dropping it", () => {
    // A total that silently omitted the dinar would look complete and be
    // wrong. Half the picker has no published rate, so this is routine.
    const out = convertSubtotals(
      [sub("EUR", 300, 75), sub("RSD", 60_000, 15_000)],
      "EUR",
      RATES,
    )!;
    assert.equal(out.group, 300);
    assert.deepEqual([...out.missing], ["RSD"]);
    assert.deepEqual([...out.converted], ["EUR"]);
  });

  it("offers nothing at all when the destination itself is unpublished", () => {
    // Not the same as an incomplete total: there is no currency to express the
    // answer in, so there is no answer to offer.
    assert.equal(convertSubtotals([sub("EUR", 300, 75)], "RSD", RATES), null);
  });

  it("still answers when the table is empty but everything is already home", () => {
    const out = convertSubtotals([sub("EUR", 300, 75)], "EUR", {})!;
    assert.equal(out.group, 300);
    assert.deepEqual([...out.missing], []);
  });

  it("totals nothing, rather than null, for a trip with no costs yet", () => {
    const out = convertSubtotals([], "EUR", RATES)!;
    assert.equal(out.group, 0);
    assert.equal(out.perPerson, 0);
  });
});
