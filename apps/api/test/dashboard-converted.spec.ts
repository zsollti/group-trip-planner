import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCostDashboard, type CostEngineOption } from "@gtp/types";
import { toTripDashboardView } from "../src/dashboard/dashboard.mapper.js";
import type { StoredRates } from "../src/rates/rates.service.js";

/**
 * The `converted` block on the cost payload (post-launch) — the glue between
 * the pure converter and the wire view.
 *
 * The arithmetic is exhausted in `exchange.spec.ts`. What is checked here is
 * the part that decides whether an approximation is offered *at all*, because
 * every one of those decisions is a promise to the reader: a total that quietly
 * omitted a currency, or one converted at rates from another month, would look
 * exactly as authoritative as a good one.
 */

const RATES: StoredRates = {
  rates: { HUF: 400, USD: 1.1 },
  asOf: "2026-08-12",
};

function option(over: Partial<CostEngineOption> = {}): CostEngineOption {
  return {
    id: `opt-${Math.random()}`,
    categoryId: "cat-1",
    status: "LOCKED",
    amount: 100,
    currency: "EUR",
    costType: "TOTAL",
    headcount: null,
    headcountIsFixed: false,
    voteCount: 0,
    headcountConfirmedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function view(
  options: CostEngineOption[],
  defaultCurrency: string,
  rates: StoredRates | null,
) {
  const result = computeCostDashboard(options, 4, null);
  return toTripDashboardView(
    { id: "t1", defaultCurrency, budgetPerPerson: null },
    4,
    [],
    result,
    new Date("2026-08-12T10:00:00.000Z"),
    rates,
  );
}

describe("the converted block", () => {
  it("is absent when there are no rates, leaving the app as it was", () => {
    const v = view([option()], "EUR", null);
    assert.equal(v.converted, null);
    // …and the exact per-currency figures are untouched either way. This is
    // the whole bargain: conversion adds, it never replaces (FR-27).
    assert.equal(v.committed[0]!.group, 100);
  });

  it("folds every currency into the trip's own", () => {
    const v = view(
      [
        option({ currency: "EUR" }),
        option({ currency: "HUF", amount: 40_000 }),
      ],
      "EUR",
      RATES,
    );
    assert.equal(v.converted?.currency, "EUR");
    assert.equal(v.converted?.committed.group, 200);
    assert.deepEqual(v.converted?.missing, []);
  });

  it("converts into the trip's currency, not into the pivot", () => {
    const v = view([option({ currency: "EUR" })], "HUF", RATES);
    assert.equal(v.converted?.currency, "HUF");
    assert.equal(v.converted?.committed.group, 40_000);
  });

  it("names a currency it had no rate for instead of dropping it silently", () => {
    // Half the picker has no published rate, so this is an ordinary trip, not
    // an exotic one.
    const v = view(
      [
        option({ currency: "EUR" }),
        option({ currency: "RSD", amount: 12_000 }),
      ],
      "EUR",
      RATES,
    );
    assert.equal(v.converted?.committed.group, 100);
    assert.deepEqual(v.converted?.missing, ["RSD"]);
  });

  it("offers nothing when the trip's own currency is unpublished", () => {
    // There is no currency to express the answer in, so there is no answer —
    // as distinct from an answer that is merely incomplete.
    assert.equal(view([option()], "RSD", RATES).converted, null);
  });

  it("describes the projection, which is the superset of the two totals", () => {
    // A currency that appears only in a front-runner still belongs in the
    // lists: they describe the whole picture the reader is looking at.
    const v = view(
      [
        option({ currency: "EUR", status: "LOCKED" }),
        option({
          currency: "RSD",
          amount: 12_000,
          status: "PROPOSED",
          categoryId: "cat-2",
        }),
      ],
      "EUR",
      RATES,
    );
    assert.deepEqual(v.converted?.missing, ["RSD"]);
    assert.equal(v.converted?.committed.group, 100);
    assert.equal(v.converted?.projected.group, 100);
  });

  it("carries the rates' publication date, so a reader can judge it", () => {
    const v = view([option()], "EUR", RATES);
    assert.equal(v.converted?.asOf, "2026-08-12");
  });
});
