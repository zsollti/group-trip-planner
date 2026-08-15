import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCostDashboard,
  optionCost,
  resolveHeadcount,
  type CostEngineOption,
} from "@gtp/types";

/**
 * The headline cost-engine suite (Phase 3.1, SRS §13 / FR-26–27) — pure, no DB,
 * no clock. Exhausts option cost (`PER_PERSON`/`TOTAL`), headcount resolution
 * (whole-group/opt-in), per-currency aggregation (never summed across
 * currencies), and the committed-vs-projected front-runner split (decision 1).
 *
 * The stale-headcount predicate used to be exhausted here too. It is gone with
 * the typed headcount it dated: a participant list cannot fall behind the
 * roster, so there is nothing left to be stale.
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
    participationMode: "WHOLE_GROUP",
    participantCount: 0,
    voteCount: 0,
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
  it("whole-group uses the current member count", () => {
    assert.equal(
      resolveHeadcount(
        { participationMode: "WHOLE_GROUP", participantCount: 3 },
        10,
      ),
      10,
    );
  });

  it("opt-in counts the members who said they are in", () => {
    assert.equal(
      resolveHeadcount(
        { participationMode: "OPT_IN", participantCount: 3 },
        10,
      ),
      3,
    );
  });

  it("opt-in with nobody in is zero, not everyone", () => {
    // Honest rather than a hole: nobody has said they are coming, so the option
    // costs the group nothing yet. Reading it as "everyone" would price it for
    // people who never agreed — the exact claim the typed number kept making.
    assert.equal(
      resolveHeadcount(
        { participationMode: "OPT_IN", participantCount: 0 },
        10,
      ),
      0,
    );
  });

  it("opt-in can exceed nothing it should not — it is bounded by who joined", () => {
    // The old fixed headcount could say 40 on a trip of 4. This cannot: every
    // unit of headcount is a row somebody wrote for themselves.
    assert.equal(
      resolveHeadcount({ participationMode: "OPT_IN", participantCount: 4 }, 4),
      4,
    );
  });
});

describe("computeCostDashboard — committed", () => {
  it("sums only locked options, per currency", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "a",
          status: "LOCKED",
          amount: 89,
          costType: "PER_PERSON",
        }),
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
    );
    // a: PER_PERSON 89 × 4 = 356 group / 89 pp; c: TOTAL 500 group / 125 pp
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 856, perPerson: 214 },
    ]);
  });

  it("keeps currencies separate — never summed across (FR-27)", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "a",
          status: "LOCKED",
          amount: 100,
          currency: "EUR",
          costType: "TOTAL",
        }),
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
    );
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 100, perPerson: 20 },
      { currency: "HUF", group: 30000, perPerson: 6000 },
    ]);
  });

  it("sorts the subtotals by currency whatever order the options arrive in", () => {
    // The contract promises sorted subtotals and the cost strip renders them in
    // array order, so a stable currency order is a real guarantee — but every
    // other case here happens to feed them in alphabetical order already, which
    // would pass without any sorting at all (Phase 7.4).
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED", amount: 10, currency: "USD" }),
        option({
          id: "b",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 10,
          currency: "CHF",
        }),
        option({
          id: "c",
          categoryId: "cat-3",
          status: "LOCKED",
          amount: 10,
          currency: "HUF",
        }),
      ],
      1,
    );
    assert.deepEqual(
      d.committed.map((s) => s.currency),
      ["CHF", "HUF", "USD"],
    );
    assert.deepEqual(
      d.projected.map((s) => s.currency),
      ["CHF", "HUF", "USD"],
    );
  });

  it("a multi-select category can contribute several locked options", () => {
    const d = computeCostDashboard(
      [
        option({ id: "a", status: "LOCKED", amount: 40, costType: "TOTAL" }),
        option({ id: "b", status: "LOCKED", amount: 60, costType: "TOTAL" }),
      ],
      2,
    );
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 100, perPerson: 50 },
    ]);
  });

  it("is empty when nothing is locked", () => {
    const d = computeCostDashboard([option({ status: "PROPOSED" })], 4);
    assert.deepEqual(d.committed, []);
  });
});

describe("computeCostDashboard — projection (front-runners)", () => {
  it("adds the top-voted proposed option of each open category", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "locked",
          status: "LOCKED",
          amount: 100,
          costType: "TOTAL",
        }),
        // open category cat-2: two proposals, higher votes wins
        option({
          id: "lo",
          categoryId: "cat-2",
          amount: 200,
          costType: "TOTAL",
          voteCount: 1,
        }),
        option({
          id: "hi",
          categoryId: "cat-2",
          amount: 500,
          costType: "TOTAL",
          voteCount: 3,
        }),
      ],
      4,
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
        option({
          id: "locked",
          status: "LOCKED",
          amount: 100,
          costType: "TOTAL",
        }),
        option({
          id: "proposed",
          status: "PROPOSED",
          amount: 999,
          costType: "TOTAL",
          voteCount: 9,
        }),
      ],
      4,
    );
    assert.deepEqual(d.projected, d.committed);
    assert.deepEqual(d.frontRunnerOptionIds, []);
  });

  it("breaks a vote tie by earliest createdAt, then id", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "z",
          amount: 10,
          costType: "TOTAL",
          voteCount: 2,
          createdAt: "2026-07-05T00:00:00.000Z",
        }),
        option({
          id: "a",
          amount: 20,
          costType: "TOTAL",
          voteCount: 2,
          createdAt: "2026-07-02T00:00:00.000Z",
        }),
        option({
          id: "m",
          amount: 30,
          costType: "TOTAL",
          voteCount: 2,
          createdAt: "2026-07-02T00:00:00.000Z",
        }),
      ],
      1,
    );
    // "a" and "m" tie on votes and time; "a" wins on id. amount 20.
    assert.deepEqual(d.frontRunnerOptionIds, ["a"]);
    assert.deepEqual(d.projected, [
      { currency: "EUR", group: 20, perPerson: 20 },
    ]);
  });

  it("with nothing locked, projection is just the front-runners", () => {
    const d = computeCostDashboard(
      [
        option({
          id: "a",
          categoryId: "cat-1",
          amount: 100,
          costType: "TOTAL",
          voteCount: 1,
        }),
        option({
          id: "b",
          categoryId: "cat-2",
          amount: 200,
          costType: "TOTAL",
          voteCount: 1,
        }),
      ],
      2,
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
    // flight €89 per-person (whole group of 5) + hotel €500 total, also whole
    // group — the arithmetic that mattered here was never about *why* the two
    // headcounts differ, only that each option divides by its own.
    const d = computeCostDashboard(
      [
        option({
          id: "flight",
          status: "LOCKED",
          amount: 89,
          costType: "PER_PERSON",
        }),
        option({
          id: "hotel",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 500,
          costType: "TOTAL",
        }),
      ],
      5,
    );
    // group = 89×5 + 500 = 945 ; per-person = 89 + 100 = 189
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 945, perPerson: 189 },
    ]);
  });

  it("an opt-in option is priced for its joiners while the rest is not", () => {
    // The case the whole model exists for: a €300 thing three of five want.
    const d = computeCostDashboard(
      [
        option({
          id: "flight",
          status: "LOCKED",
          amount: 89,
          costType: "PER_PERSON",
        }),
        option({
          id: "surf",
          categoryId: "cat-2",
          status: "LOCKED",
          amount: 300,
          costType: "TOTAL",
          participationMode: "OPT_IN",
          participantCount: 3,
        }),
      ],
      5,
    );
    const surf = d.options.find((o) => o.optionId === "surf");
    assert.equal(surf?.effectiveHeadcount, 3);
    // group = 89×5 + 300 = 745 ; per-person = 89 + 100 = 189, where the 100 is
    // divided by the three who joined rather than by the five on the trip.
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 745, perPerson: 189 },
    ]);
  });

  it("an opt-in option nobody joined costs nothing yet", () => {
    const d = computeCostDashboard(
      [
        option({
          status: "LOCKED",
          amount: 400,
          costType: "TOTAL",
          participationMode: "OPT_IN",
          participantCount: 0,
        }),
      ],
      10,
    );
    assert.equal(d.options[0]?.effectiveHeadcount, 0);
    // A total nobody has signed up for is not the group's money, and the
    // per-head share of it is not a division by zero either.
    assert.deepEqual(d.committed, [
      { currency: "EUR", group: 400, perPerson: 0 },
    ]);
  });

  it("a whole-group option follows the live count as it changes", () => {
    // What the fixed headcount could not do, and the reason it needed a
    // staleness rule: this one is simply right afterwards.
    const four = computeCostDashboard(
      [option({ status: "LOCKED", amount: 400, costType: "TOTAL" })],
      4,
    );
    const ten = computeCostDashboard(
      [option({ status: "LOCKED", amount: 400, costType: "TOTAL" })],
      10,
    );
    assert.equal(four.options[0]?.effectiveHeadcount, 4);
    assert.equal(ten.options[0]?.effectiveHeadcount, 10);
    assert.equal(four.committed[0]?.perPerson, 100);
    assert.equal(ten.committed[0]?.perPerson, 40);
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
    );
    assert.deepEqual(d.options.map((o) => o.optionId).sort(), ["a", "b", "c"]);
  });

  it("an empty trip yields empty totals", () => {
    const d = computeCostDashboard([], 4);
    assert.deepEqual(d.committed, []);
    assert.deepEqual(d.projected, []);
    assert.deepEqual(d.options, []);
    assert.deepEqual(d.frontRunnerOptionIds, []);
  });
});
