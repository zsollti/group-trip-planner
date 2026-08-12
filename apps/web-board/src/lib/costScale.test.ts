import { describe, expect, it } from "vitest";
import { costScale } from "./costScale";

/**
 * The bar's arithmetic. What is worth asserting here is the *meaning* of the
 * width — which quantity is 100%, and where the target sits inside it — because
 * that is the part a reader will take a decision from.
 */

describe("costScale without a target", () => {
  it("fills the width, since the spend is its own basis", () => {
    const s = costScale({ committed: 300, projected: 500 });
    expect(s.committedPct + s.extraPct).toBeCloseTo(100);
    expect(s.committedPct).toBeCloseTo(60);
    expect(s.markerPct).toBeNull();
    expect(s.againstTarget).toBe(false);
  });

  it("draws nothing when nothing is priced", () => {
    expect(costScale({ committed: 0, projected: 0 })).toEqual({
      committedPct: 0,
      extraPct: 0,
      markerPct: null,
      againstTarget: false,
    });
  });
});

describe("costScale under the target", () => {
  it("makes the target the full width and leaves the rest empty", () => {
    // 500 of an 800 target: five eighths spent, three eighths of room left.
    const s = costScale({ committed: 200, projected: 500, target: 800 });
    expect(s.committedPct + s.extraPct).toBeCloseTo(62.5);
    expect(s.againstTarget).toBe(true);
    // The end of the track is the target, so marking it would say it twice.
    expect(s.markerPct).toBeNull();
  });

  it("keeps the locked-to-front-runner ratio the scaling found it in", () => {
    const bare = costScale({ committed: 200, projected: 500 });
    const scaled = costScale({ committed: 200, projected: 500, target: 800 });
    expect(scaled.committedPct / scaled.extraPct).toBeCloseTo(
      bare.committedPct / bare.extraPct,
    );
  });

  it("shows a target that nothing has been spent against yet", () => {
    const s = costScale({ committed: 0, projected: 0, target: 800 });
    expect(s.committedPct).toBe(0);
    expect(s.extraPct).toBe(0);
    expect(s.againstTarget).toBe(true);
  });

  it("treats landing exactly on the target as under it", () => {
    const s = costScale({ committed: 0, projected: 800, target: 800 });
    expect(s.extraPct).toBeCloseTo(100);
    expect(s.markerPct).toBeNull();
  });
});

describe("costScale over the target", () => {
  it("makes the spend the full width and marks where the target fell", () => {
    // 1000 spent against an 800 target: the mark sits four fifths along.
    const s = costScale({ committed: 400, projected: 1000, target: 800 });
    expect(s.committedPct + s.extraPct).toBeCloseTo(100);
    expect(s.markerPct).toBeCloseTo(80);
    expect(s.againstTarget).toBe(false);
  });

  it("puts the mark further left the worse the overshoot is", () => {
    const bad = costScale({ committed: 0, projected: 1000, target: 800 });
    const worse = costScale({ committed: 0, projected: 4000, target: 800 });
    expect(worse.markerPct!).toBeLessThan(bad.markerPct!);
  });

  it("marks the left edge for a target of zero", () => {
    // Legal (the schema allows a zero budget) and unambiguous: every penny is
    // past the line, so the line is at the start.
    const s = costScale({ committed: 0, projected: 50, target: 0 });
    expect(s.markerPct).toBe(0);
    expect(s.extraPct).toBeCloseTo(100);
  });
});

describe("costScale on bad input", () => {
  it("ignores a negative target rather than drawing a mark off the chart", () => {
    const s = costScale({ committed: 0, projected: 500, target: -100 });
    expect(s.markerPct).toBeNull();
    expect(s.extraPct).toBeCloseTo(100);
  });

  it("never runs a segment past the end when locked exceeds projected", () => {
    const s = costScale({ committed: 900, projected: 500 });
    expect(s.committedPct + s.extraPct).toBeLessThanOrEqual(100);
  });
});
