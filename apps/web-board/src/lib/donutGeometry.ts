/**
 * Where each wedge of the cost donut starts and how long it runs.
 *
 * Split out from the component for the same reason `costScale` was: this is the
 * part that can be subtly wrong in a way no DOM assertion notices. A wedge two
 * degrees off, or a gap that eats a small slice entirely, renders as a
 * perfectly plausible chart of the wrong trip.
 *
 * The ring is drawn as one stroked circle per wedge, each dashed so that only
 * its own span is painted — so what a caller needs from this module is a length
 * and a distance from the ring's start, both in SVG user units.
 */

/** One painted span of the ring. */
export interface DonutArc {
  /** Visible stroke length, gap already deducted. */
  readonly length: number;
  /** Distance from the ring's start to where this span begins. */
  readonly start: number;
}

/**
 * A wedge never shrinks below this, however small its share.
 *
 * Subtracting the gap from a short arc can take it to zero or past it, and a
 * slice that vanishes is worse than a slice that is merely thin: the legend
 * beside it still names a lane, so the reader looks for a colour that is not
 * there. Better a hairline that is honestly hard to measure.
 */
const MIN_ARC = 1;

/**
 * Lay the shares out around the ring.
 *
 * The gap is deducted from each wedge's *painted* length while its neighbour's
 * start stays where the share puts it, so the wedges keep their true angles and
 * the gap is carved out of the fill rather than added to the circle. Do it the
 * other way — advance each start by the gap — and a ring of eight lanes comes
 * up short by eight gaps, which reads as phantom headroom.
 *
 * Shares are fractions of the whole circle and are expected to sum to at most
 * 1; the caller's headroom is simply the part it does not pass in.
 */
export function donutArcs(
  shares: readonly number[],
  circumference: number,
  gap: number,
): DonutArc[] {
  const arcs: DonutArc[] = [];
  let cursor = 0;
  for (const share of shares) {
    const span = share * circumference;
    arcs.push({ start: cursor, length: Math.max(span - gap, MIN_ARC) });
    cursor += span;
  }
  return arcs;
}

/**
 * A point on the ring, in SVG coordinates, for a fraction of the way round.
 *
 * Zero is twelve o'clock and the sweep is clockwise, which is where a reader
 * expects a part-to-whole chart to start — SVG's own angle zero is at three
 * o'clock, hence the quarter turn.
 */
export function pointOnRing(
  fraction: number,
  radius: number,
  centre: number,
): { x: number; y: number } {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return {
    x: centre + radius * Math.cos(angle),
    y: centre + radius * Math.sin(angle),
  };
}
