import { describe, expect, it } from "vitest";
import type { TripDashboardView } from "@gtp/types";
import { lockedCost, targetVerdict } from "./costSummary";

/**
 * What one figure may claim about a trip's cost.
 *
 * The branch that matters is not arithmetic, it is **honesty**: when may the
 * board print a single total, when must it say `≈`, and when must it refuse and
 * show the parts? FR-27's guarantee lives or dies here.
 */

function dashboard(over: Partial<TripDashboardView> = {}): TripDashboardView {
  return {
    tripId: "t1",
    defaultCurrency: "EUR",
    budgetPerPerson: null,
    memberCount: 4,
    committed: [],
    projected: [],
    lines: [],
    hasStaleHeadcount: false,
    converted: null,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

const part = (currency: string, group: number, perPerson: number) => ({
  currency,
  group,
  perPerson,
});

/** An all-in figure as the server sends it. */
function converted(
  currency: string,
  committed: { group: number; perPerson: number },
  missing: string[] = [],
): TripDashboardView["converted"] {
  return {
    currency,
    committed,
    projected: committed,
    asOf: "2026-08-12",
    converted: [currency],
    missing,
  };
}

describe("lockedCost", () => {
  it("has no figure at all before anything is locked and priced", () => {
    expect(lockedCost(dashboard()).allIn).toBeNull();
  });

  it("takes a single currency's subtotal as the exact total", () => {
    const { allIn } = lockedCost(
      dashboard({ committed: [part("EUR", 400, 100)] }),
    );
    expect(allIn).toEqual({
      group: 400,
      perPerson: 100,
      currency: "EUR",
      approximate: false,
      missing: [],
    });
  });

  it("stays exact for one currency even when rates are available", () => {
    // Converting a figure that needs no conversion trades a number that is
    // right for one that is roughly right, and buys nothing with it.
    const { allIn } = lockedCost(
      dashboard({
        committed: [part("GBP", 400, 100)],
        converted: converted("EUR", { group: 470, perPerson: 117.5 }),
      }),
    );
    expect(allIn?.currency).toBe("GBP");
    expect(allIn?.approximate).toBe(false);
    expect(allIn?.group).toBe(400);
  });

  it("combines several currencies only through the rates, and marks it", () => {
    const { allIn } = lockedCost(
      dashboard({
        committed: [part("EUR", 400, 100), part("HUF", 35000, 8750)],
        converted: converted("EUR", { group: 500, perPerson: 125 }),
      }),
    );
    expect(allIn?.approximate).toBe(true);
    expect(allIn?.group).toBe(500);
    expect(allIn?.currency).toBe("EUR");
  });

  it("refuses to invent a total when there is no rate to cross (FR-27)", () => {
    // The rule the whole feature is built around: no *exact* total may silently
    // mix currencies, and an inexact one needs rates it does not have.
    const { parts, allIn } = lockedCost(
      dashboard({
        committed: [part("EUR", 400, 100), part("HUF", 35000, 8750)],
      }),
    );
    expect(allIn).toBeNull();
    expect(parts).toHaveLength(2);
  });

  it("names only the currencies its own total was missing", () => {
    // `missing` describes the projection, which is the superset, so it can name
    // a currency nothing is locked in — reporting that against the locked total
    // would blame it for leaving out money it was never asked to count.
    const { allIn } = lockedCost(
      dashboard({
        committed: [part("EUR", 400, 100), part("RSD", 60000, 15000)],
        converted: converted("EUR", { group: 400, perPerson: 100 }, [
          "RSD",
          "MKD",
        ]),
      }),
    );
    expect(allIn?.missing).toEqual(["RSD"]);
  });
});

describe("targetVerdict", () => {
  const withTarget = (over: Partial<TripDashboardView>) =>
    dashboard({ budgetPerPerson: 800, ...over });

  it("says nothing when the trip has no target", () => {
    const d = dashboard({ committed: [part("EUR", 400, 100)] });
    expect(targetVerdict(d, lockedCost(d))).toBeNull();
  });

  it("reads locked money, not what the front-runners might cost", () => {
    // The change of question: a target used to be read against the projection,
    // which answered "what will this cost if the likely winners win". A group
    // asking whether it can afford the next thing is asking about the present.
    const d = withTarget({
      committed: [part("EUR", 1200, 300)],
      projected: [part("EUR", 4000, 1000)],
    });
    const v = targetVerdict(d, lockedCost(d))!;
    expect(v.spend).toBe(300);
    expect(v.over).toBe(false);
    expect(v.gap).toBe(500);
  });

  it("reads the whole trip once there is an all-in figure", () => {
    const d = withTarget({
      committed: [part("EUR", 1200, 300), part("HUF", 60000, 15000)],
      converted: converted("EUR", { group: 1860, perPerson: 465 }),
    });
    const v = targetVerdict(d, lockedCost(d))!;
    // 800 − 465, not 800 − 300: the forints are in the picture.
    expect(v.spend).toBe(465);
    expect(v.gap).toBe(335);
    expect(v.approximate).toBe(true);
    expect(v.uncounted).toEqual([]);
  });

  it("falls back to the trip's own currency and says what it left out", () => {
    // No rates: comparing across currencies is exactly what FR-27 forbids, so
    // the verdict narrows and names the narrowing rather than implying cover.
    const d = withTarget({
      committed: [part("EUR", 1200, 300), part("HUF", 60000, 15000)],
    });
    const v = targetVerdict(d, lockedCost(d))!;
    expect(v.spend).toBe(300);
    expect(v.approximate).toBe(false);
    expect(v.uncounted).toEqual(["HUF"]);
  });

  it("stays exact when the all-in figure needed no conversion", () => {
    const d = withTarget({ committed: [part("EUR", 1200, 300)] });
    expect(targetVerdict(d, lockedCost(d))!.approximate).toBe(false);
  });

  it("does not borrow another currency's figure for the target", () => {
    // A trip that prices in EUR and has locked only pounds: the target speaks
    // for euros, and nothing has been spent in euros. Zero is the true answer;
    // 400 would be a silent cross-currency claim.
    const d = withTarget({ committed: [part("GBP", 1600, 400)] });
    const v = targetVerdict(d, lockedCost(d))!;
    expect(v.spend).toBe(0);
    expect(v.uncounted).toEqual(["GBP"]);
  });

  it("reports an overspend as a positive distance the other way", () => {
    const d = withTarget({ committed: [part("EUR", 4000, 1000)] });
    const v = targetVerdict(d, lockedCost(d))!;
    expect(v.over).toBe(true);
    expect(v.gap).toBe(200);
  });

  it("keeps per-person money per-person on a fixed-headcount option", () => {
    // The catch: an option split among a fixed four on a trip of eight makes
    // `perPerson` something other than `group / memberCount`. The verdict must
    // take the engine's per-head answer, never divide the group total itself.
    const d = withTarget({
      memberCount: 8,
      committed: [part("EUR", 3200, 800)],
    });
    const v = targetVerdict(d, lockedCost(d))!;
    expect(v.spend).toBe(800);
    expect(v.over).toBe(false);
    expect(v.gap).toBe(0);
  });
});
