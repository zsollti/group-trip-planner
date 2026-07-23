import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isVoteStale } from "@gtp/types";

/**
 * Pure vote-staleness rule (no DB): a vote is stale iff it was cast before the
 * option's last material (cost/date) change (FR-23, decision 3). This is the
 * single definition the mapper computes on read — there is no `stale` column.
 */
describe("isVoteStale", () => {
  const voted = "2026-07-23T10:00:00.000Z";

  it("is never stale when the option had no material edit", () => {
    assert.equal(isVoteStale(voted, null), false);
  });

  it("is stale when the material change happened after the vote", () => {
    assert.equal(isVoteStale(voted, "2026-07-23T12:00:00.000Z"), true);
  });

  it("is not stale when the vote came after the material change", () => {
    assert.equal(isVoteStale(voted, "2026-07-23T08:00:00.000Z"), false);
  });

  it("is not stale at the exact same instant (strictly-before)", () => {
    assert.equal(isVoteStale(voted, voted), false);
  });
});
