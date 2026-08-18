/**
 * Fitting a figure inside the donut's hole.
 *
 * The centre used to be a fixed 1.15rem, which is fine for `€2,140` and breaks
 * completely for `1 234 567 Ft` — and Hungarian forint is not an edge case, it
 * is *every* trip priced in it. Six figures plus a grouped thousands separator
 * and a suffix is a twelve-character string in a hole about a hundred pixels
 * wide, so it ran out over the ring and past it.
 *
 * Pulled out of the component because it is arithmetic that renders as a
 * plausible chart when wrong: text that overflows a hole still *draws*, it just
 * draws over the wedges, and no DOM assertion notices. A number here is
 * checkable.
 */

/**
 * The hole's width as a fraction of the donut's **viewBox** — `(r - t/2) * 2 / view`.
 *
 * The denominator is the padded box (`VIEW` in `CostDonut`), not the ring's own
 * 120: the over-budget band and its tick are drawn outside the wedges and ran
 * past the old viewBox's edge, so the box grew by `VIEW_PAD` on every side and
 * the hole is that much smaller a share of it.
 */
export const HOLE_FRACTION = ((48 - 16 / 2) * 2) / 128;

/**
 * How wide the donut is drawn, in CSS pixels — **must match `.cost-donut`.**
 *
 * Duplicated from the stylesheet on purpose: the figure in the hole is sized by
 * arithmetic (see below) and arithmetic needs a real width, while the element's
 * own width is not knowable until it is laid out — which under test is never.
 */
export const BOX_PX = 148;

/** The hole, in the same pixels. What a figure has to fit inside. */
export const HOLE_PX = Math.round(BOX_PX * HOLE_FRACTION);

/**
 * Roughly how wide one character is, as a multiple of the font size.
 *
 * Deliberately pessimistic. The strings here are mostly digits, separators and
 * a currency symbol; digits are tabular-ish and narrow, but `Ft`, `zł` and a
 * non-breaking thousands space are not, and being a little too small is
 * invisible while being a little too big is the bug this exists to prevent.
 */
const CHAR_WIDTH = 0.62;

/** Never smaller than this — past it the figure is unreadable anyway. */
const MIN_REM = 0.62;
/** Never larger than this: the size the centre had when it fitted. */
const MAX_REM = 1.15;

/**
 * A font size in `rem` that keeps `text` inside a hole `holePx` wide.
 *
 * Returns a number rather than a class so the scale is continuous — a stepped
 * set of sizes means one extra digit can drop the figure a whole step, and the
 * total visibly changing size as a trip crosses a round number reads as a bug.
 */
export function centreFontRem(text: string, holePx: number): number {
  const chars = Math.max(text.length, 1);
  // A little breathing room, so the longest string never touches the ring.
  const usable = holePx * 0.92;
  const ideal = usable / (chars * CHAR_WIDTH) / 16;
  return Math.min(MAX_REM, Math.max(MIN_REM, round2(ideal)));
}

/** Two decimals: enough to be smooth, few enough to be stable across renders. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
