import { describe, expect, it } from "vitest";
import type { CategoryView, OptionView } from "@gtp/types";
import { needsDecision, sortLanes } from "./laneSort";

/**
 * Lane ordering is a per-user *view* over the server's stored positions, so the
 * rules worth pinning are: what counts as "still needs a decision", and that
 * sorting never disturbs the manual order it is layered on top of.
 */

function cat(id: string, position: number): CategoryView {
  return {
    id,
    name: id,
    singleChoice: false,
    isBuiltin: false,
    builtinKey: null,
    position,
    version: 0,
  };
}

function opt(status: OptionView["status"]): OptionView {
  return {
    id: `o-${status}-${Math.random()}`,
    categoryId: "c",
    title: "x",
    description: null,
    url: null,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    startsAt: null,
    endsAt: null,
    externalRef: null,
    status,
    version: 0,
    proposerId: "u1",
    proposerName: "Ada",
    materialChangedAt: null,
    createdAt: new Date().toISOString(),
    lockedByName: null,
    lockedAt: null,
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
  };
}

describe("needsDecision", () => {
  it("is true when cards are proposed and none is locked", () => {
    expect(needsDecision([opt("PROPOSED"), opt("PROPOSED")])).toBe(true);
  });

  it("is false once anything is locked", () => {
    expect(needsDecision([opt("PROPOSED"), opt("LOCKED")])).toBe(false);
  });

  it("is false for an empty category — nothing to decide yet", () => {
    // Matches the home dashboard's pendingDecisionCount, so an untouched lane
    // doesn't jump the queue ahead of one actually waiting on a call.
    expect(needsDecision([])).toBe(false);
  });
});

describe("sortLanes", () => {
  const a = cat("a", 0); // decided
  const b = cat("b", 1); // undecided
  const c = cat("c", 2); // empty
  const d = cat("d", 3); // undecided
  const options = {
    a: [opt("LOCKED")],
    b: [opt("PROPOSED")],
    c: [],
    d: [opt("PROPOSED")],
  };

  it("leaves the stored order untouched in manual mode", () => {
    expect(sortLanes([a, b, c, d], options, "manual").map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("floats undecided lanes first, preserving manual order within each group", () => {
    expect(
      sortLanes([a, b, c, d], options, "undecided").map((x) => x.id),
    ).toEqual(["b", "d", "a", "c"]);
  });

  it("does not mutate the array it is given", () => {
    const input = [a, b, c, d];
    sortLanes(input, options, "undecided");
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});
