import { describe, expect, it } from "vitest";
import { donutArcs, pointOnRing } from "./donutGeometry";

describe("donutArcs", () => {
  it("starts each wedge where the last one's share ended, not where its ink did", () => {
    // The gap is carved out of the fill; it must not push the next wedge along.
    // Advancing by the gap instead would leave a ring of n wedges n gaps short,
    // which reads as headroom nobody has.
    const arcs = donutArcs([0.5, 0.5], 100, 4);
    expect(arcs[0]).toEqual({ start: 0, length: 46 });
    expect(arcs[1]).toEqual({ start: 50, length: 46 });
  });

  it("keeps a sliver visible rather than letting the gap eat it", () => {
    const [only] = donutArcs([0.01], 100, 4);
    expect(only!.length).toBe(1);
  });

  it("leaves the unpassed remainder alone, which is the caller's headroom", () => {
    const arcs = donutArcs([0.25], 100, 0);
    expect(arcs[0]!.start + arcs[0]!.length).toBe(25);
  });
});

describe("pointOnRing", () => {
  it("puts zero at twelve o'clock, where a reader starts", () => {
    const p = pointOnRing(0, 10, 50);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(40);
  });

  it("sweeps clockwise", () => {
    // A quarter turn from the top is three o'clock, not nine.
    const p = pointOnRing(0.25, 10, 50);
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(50);
  });
});
