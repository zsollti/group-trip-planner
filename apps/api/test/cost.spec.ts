import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCostDashboard,
  isHeadcountStale,
  optionCost,
  resolveHeadcount,
  type CostEngineOption,
} from "@gtp/types";

/**
 * The headline cost-engine suite (Phase 3.1, SRS §13 / FR-26–27) — pure, no DB,
 * no clock. Exhausts option cost (`PER_PERSON`/`TOTAL`), headcount resolution
 * (fixed/dynamic), per-currency aggregation (never summed across currencies),
 * the committed-vs-projected front-runner split (decision 1), and the
 * stale-headcount predicate (decision 2).
 */

/** Build a proposed EUR option, overriding just the fields a case cares about. */
function option(over: Partial<CostEngineOption> = {}): CostEngineOption {
  return {
    id: "opt-1",
    categoryId: "cat-1",
    status: "PROPOSED",
    amount: 100,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    voteCount: 0,
    headcountConfirmedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("optionCost", () => {
  it("PER_PERSON scales the group by headcount, per-head is the amount", () => {
    assert.deepEqual(optionCost(89, "PER_PERSON", 4), {
      group: 356,
      perPerson: 89,
    });
  });

  it("TOTAL is fixed for the group, per-head is the split", () => {
    assert.deepEqual(optionCost(500, "TOTAL", 5), {
      group: 500,
      perPerson: 100,
    });
  });

  it("an unpriced option costs zero either way", () => {
    assert.deepEqual(optionCost(null, "PER_PERSON", 4), {
      group: 0,
      perPerson: 0,
    });
    assert.deepEqual(optionCost(null, "TOTAL", 4), { group: 0, perPerson: 0 });
  });

  it("a zero headcount never divides by zero", () => {
    assert.deepEqual(optionCost(500, "TOTAL", 0), { group: 500, perPerson: 0 });
    assert.deepEqual(optionCost(89, "PER_PERSON", 0), {
      group: 0,
      perPerson: 89,
    });
  });
});

describe("resolveHeadcount", () => {
  it("fixed uses the stored number", () => {
    assert.equal(
      resolveHeadcount({ headcountIsFixed: true, headcount: 3 }, 10),
      3,
    );
  });

  it("dynamic uses the current member count", () => {
    assert.equal(
      resolveHeadcount({ headcountIsFixed: false, headcount: 3 }, 10),
      10,
    );
  });

  it("fixed but missing a number falls back to the live count", () => {
    assert.equal(
      resolveHeadcount({ headcountIsFixed: true, headcount: null }, 10),
      10,
    );
  });
});

describe("isHeadcountStale", () => {
  const changed = "2026-07-10T00:00:00.000Z";

  it("a dynamic headcount is never stale", () => {
    assert.equal(isHeadcountStale(false, "2026-07-01T00:00:00.000Z", changed), false);
    assert.equal(isHeadcountStale(false, null, changed), false);
  });

  it("no membership change means nothing is stale", () => {
    assert.equal(isHeadcountStale(true, "2026-07-01T00:00:00.000Z", null), false);
    assert.equal(isHeadcountStale(true, null, null), false);
  });

  it("fixed and confirmed before the change is stale", () => {
    assert.equal(isHeadcountStale(true, "2026-07-01T00:00:00.000Z", changed), true);
  });

  it("fixed and confirmed after the change is fresh", () => {
    assert.equal(isHeadcountStale(true, "2026-07-20T00:00:00.000Z", changed), false);
  });

  it("confirmed exactly at the change is fresh (strictly before)", () => {
    assert.equal(isHeadcountStale(true, changed, changed), false);
  });

  it("fixed with an unknown confirmation time is stale once membership changed", () => {
    assert.equal(isHeadcountStale(true, null, changed), true);
  });
});

describe("computeCostDashboard — committed", () => {
  it("sums only locked options, per currency", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED", amount: 89, costType: "PER_PERSON" }),
        option({ id: "b", status: "PROPOSED", amount: 999 }), // ignored: proposed, and lands in projection
        option({
          id: "c",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 500,
          costType: "TOTAL",
        }),
      ],
      4,
      null,
    );
    // a: PER_PERSON 89 × 4 = 356 group / 89 pp; c: TOTAL 500 group / 125 pp
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 856, perPerson: 214 },
    ]);
  });

  it("keeps currencies separate — never summed across (FR-27)", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED", amount: 100, currency: "EUR", costType: "TOTAL" }),
        option({
          id: "b",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 30000,
          currency: "HUF",
          costType: "TOTAL",
        }),
      ],
      5,
      null,
    );
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 100, perPerson: 20 },
      { currency: "HUF", group: 30000, perPerson: 6000 },
    ]);
  });

  it("a multi-select category can contribute several locked options", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED", amount: 40, costType: "TOTAL" }),
        option({ id: "b", status: "LOCKED", amount: 60, costType: "TOTAL" }),
      ],
      2,
      null,
    );
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 100, perPerson: 50 },
    ]);
  });

  it("is empty when nothing is locked", () => {
    const d = computeCostDashboard([option({ status: "PROPOSED" })], 4, null);
    assert.deepEqual(d.committed, []);
  });
});

describe("computeCostDashboard — projection (front-runners)", () => {
  it("adds the top-voted proposed option of each open category", () => {
    const d = computeCostDashboard(
      [
        option({ id: "locked", status: "LOCKED", amount: 100, costType: "TOTAL" }),
        // open category cat-2: two proposals, higher votes wins
        option({ id: "lo", categoryId: "cat-2", amount: 200, costType: "TOTAL", voteCount: 1 }),
        option({ id: "hi", categoryId: "cat-2", amount: 500, costType: "TOTAL", voteCount: 3 }),
      ],
      4,
      null,
    );
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 100, perPerson: 25 },
    ]);
    // projected = 100 (locked) + 500 (front-runner "hi")
    assert.deepEqual(d.projected, [
      { currency: "EUR", group: 600, perPerson: 150 },
    ]);
    assert.deepEqual(d.frontRunnerOptionIds, ["hi"]);
  });

  it("does not add a front-runner to a category that already has a locked option", () => {
    const d = computeCostDashboard(
      [
        option({ id: "locked", status: "LOCKED", amount: 100, costType: "TOTAL" }),
        option({ id: "proposed", status: "PROPOSED", amount: 999, costType: "TOTAL", voteCount: 9 }),
      ],
      4,
      null,
    );
    assert.deepEqual(d.projected, d.committed);
    assert.deepEqual(d.frontRunnerOptionIds, []);
  });

  it("breaks a vote tie by earliest createdAt, then id", () => {
    const d = computeCostDashboard(
      [
        option({ id: "z", amount: 10, costType: "TOTAL", voteCount: 2, createdAt: "2026-07-05T00:00:00.000Z" }),
        option({ id: "a", amount: 20, costType: "TOTAL", voteCount: 2, createdAt: "2026-07-02T00:00:00.000Z" }),
        option({ id: "m", amount: 30, costType: "TOTAL", voteCount: 2, createdAt: "2026-07-02T00:00:00.000Z" }),
      ],
      1,
      null,
    );
    // "a" and "m" tie on votes and time; "a" wins on id. amount 20.
    assert.deepEqual(d.frontRunnerOptionIds, ["a"]);
    assert.deepEqual(d.projected, [{ currency: "EUR", group: 20, perPerson: 20 }]);
  });

  it("with nothing locked, projection is just the front-runners", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", categoryId: "cat-1", amount: 100, costType: "TOTAL", voteCount: 1 }),
        option({ id: "b", categoryId: "cat-2", amount: 200, costType: "TOTAL", voteCount: 1 }),
      ],
      2,
      null,
    );
    assert.deepEqual(d.committed, []);
    assert.deepEqual(d.projected, [
      { currency: "EUR", group: 300, perPerson: 150 },
    ]);
    assert.deepEqual(new Set(d.frontRunnerOptionIds), new Set(["a", "b"]));
  });
});

describe("computeCostDashboard — per-person across mixed headcounts", () => {
  it("sums each option's own per-head cost, not group ÷ one headcount", () => {
    // flight €89 per-person (dynamic, 5 members) + hotel €500 total fixed for 5
    const d = computeCostDashboard(
      [
        option({ id: "flight", status: "LOCKED", amount: 89, costType: "PER_PERSON" }),
        option({
          id: "hotel",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 500,
          costType: "TOTAL",
          headcount: 5,
          headcountIsFixed: true,
          headcountConfirmedAt: "2026-07-01T00:00:00.000Z",
        }),
      ],
      5,
      null,
    );
    // group = 89×5 + 500 = 945 ; per-person = 89 + 100 = 189
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 945, perPerson: 189 },
    ]);
  });

  it("a fixed headcount is not recalculated when the live count differs", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "hotel",
          status: "LOCKED",
          amount: 400,
          costType: "TOTAL",
          headcount: 4,
          headcountIsFixed: true,
        }),
      ],
      10, // live count grew, but fixed stays 4
      null,
    );
    assert.equal(d.options[0]?.effectiveHeadcount, 4);
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 400, perPerson: 100 },
    ]);
  });
});

describe("computeCostDashboard — stale-headcount flag", () => {
  const changed = "2026-07-10T00:00:00.000Z";
  const staleFixed = (over: Partial<CostEngineOption>) =>
    option({
      amount: 300,
      costType: "TOTAL",
      headcount: 3,
      headcountIsFixed: true,
      headcountConfirmedAt: "2026-07-01T00:00:00.000Z",
      ...over,
    });

  it("flags the trip when a locked option's fixed headcount is stale", () => {
    const d = computeCostDashboard([staleFixed({ status: "LOCKED" })], 5, changed);
    assert.equal(d.hasStaleHeadcount, true);
    assert.equal(d.options[0]?.headcountStale, true);
  });

  it("flags the trip when a front-runner's fixed headcount is stale", () => {
    const d = computeCostDashboard([staleFixed({ status: "PROPOSED", voteCount: 1 })], 5, changed);
    assert.equal(d.hasStaleHeadcount, true);
  });

  it("does NOT flag the trip for a stale option that feeds no total", () => {
    // A stale proposed option that is not its category's front-runner.
    const d = computeCostDashboard(
      [
        option({ id: "winner", amount: 10, costType: "TOTAL", voteCount: 5 }),
        staleFixed({ id: "loser", status: "PROPOSED", voteCount: 0 }),
      ],
      5,
      changed,
    );
    assert.equal(d.frontRunnerOptionIds[0], "winner");
    assert.equal(d.hasStaleHeadcount, false);
    // ...but the per-option breakdown still marks it stale for the card.
    const loser = d.options.find((o) => o.optionId === "loser");
    assert.equal(loser?.headcountStale, true);
  });

  it("dynamic options are never stale even after a membership change", () => {
    const d = computeCostDashboard(
      [option({ status: "LOCKED", headcountIsFixed: false })],
      5,
      changed,
    );
    assert.equal(d.hasStaleHeadcount, false);
  });
});

describe("computeCostDashboard — shape & edge cases", () => {
  it("returns a per-option cost for every input option", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED" }),
        option({ id: "b", categoryId: "cat-2", status: "PROPOSED" }),
        option({ id: "c", categoryId: "cat-3", amount: null }),
      ],
      4,
      null,
    );
    assert.deepEqual(
      d.options.map((o) => o.optionId).sort(),
      ["a", "b", "c"],
    );
  });

  it("an empty trip yields empty totals and no warning", () => {
    const d = computeCostDashboard([], 4, "2026-07-10T00:00:00.000Z");
    assert.deepEqual(d.committed, []);
    assert.deepEqual(d.projected, []);
    assert.deepEqual(d.options, []);
    assert.deepEqual(d.frontRunnerOptionIds, []);
    assert.equal(d.hasStaleHeadcount, false);
  });
});
