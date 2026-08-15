import type { CategoryView } from "@gtp/types";
import type { CostComposition } from "../lib/costComposition";
import { donutArcs, pointOnRing } from "../lib/donutGeometry";
import { categoryHueStyleById } from "../lib/categoryTheme";

/**
 * Where the trip's locked money went, as one ring.
 *
 * **A full circle is `max(spend, target)`** — one rule that reads both ways.
 * Under the target the wedges are the spend and the dark remainder is headroom;
 * past it the wedges fill the ring and the target is marked *inside* them, so
 * the overshoot has a visible length. Without that mark a trip €5 over and one
 * €5,000 over draw the identical full circle, which is exactly what retired the
 * previous chart.
 *
 * **Colour follows the lane, never the wedge's rank.** Each wedge wears the
 * palette its category wears on the board, so re-sorting the ring (or locking
 * something new) never repaints the survivors, and the lanes themselves are the
 * legend. The tail wedge has no category and takes the neutral.
 *
 * It is `aria-hidden`, because the breakdown rendered beside it is the same
 * information as text — names, amounts and shares — and is the version a screen
 * reader should get. That list is not a fallback: this board's own rule is that
 * colour reinforces and never carries the message, and a ring of eight
 * user-chosen hues is precisely where that has to be true. Two of the eight
 * palettes are close enough that adjacent wedges are hard to separate; the
 * names and figures next to them are what make that a cosmetic annoyance
 * instead of lost information.
 */

const SIZE = 120;
const CENTRE = SIZE / 2;
const RADIUS = 48;
const THICKNESS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Matches the 2px the stacked bar puts between its segments. */
const GAP = 2.5;

export function CostDonut({
  composition,
  categories,
  label,
}: {
  composition: CostComposition;
  categories: readonly CategoryView[];
  /** The figure for the middle — the strip's own words, not re-derived here. */
  label: { headline: string; caption: string; exact?: string | null };
}) {
  const { slices, targetMark, overspend } = composition;
  const arcs = donutArcs(
    slices.map((s) => s.share),
    CIRCUMFERENCE,
    GAP,
  );
  const drawn = slices.reduce((sum, s) => sum + s.share, 0);
  // The remainder is headroom only when something is left of the circle. At or
  // over the target the wedges are the whole ring and this is nothing.
  const headroom = Math.max(1 - drawn, 0);

  return (
    <div className="cost-donut">
      <svg
        className="cost-donut__ring"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <g transform={`rotate(-90 ${CENTRE} ${CENTRE})`}>
          {headroom > 0 ? (
            <circle
              className="cost-donut__headroom"
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              strokeWidth={THICKNESS}
              strokeDasharray={`${Math.max(headroom * CIRCUMFERENCE - GAP, 0)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-drawn * CIRCUMFERENCE}
            />
          ) : null}
          {slices.map((slice, i) => (
            <circle
              key={slice.categoryId ?? "tail"}
              className={
                "cost-donut__wedge" +
                (slice.categoryId === null ? " cost-donut__wedge--tail" : "")
              }
              style={categoryHueStyleById(slice.categoryId, categories)}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              strokeWidth={THICKNESS}
              strokeDasharray={`${arcs[i]!.length} ${CIRCUMFERENCE}`}
              strokeDashoffset={-arcs[i]!.start}
            />
          ))}
        </g>
        {/* Drawn last so it sits over the fills it crosses, and only when it has
            something to say: at or under the target the wedges already end
            where it would fall. */}
        {targetMark !== null && overspend > 0 ? (
          <TargetNotch at={targetMark} />
        ) : null}
      </svg>
      <div className="cost-donut__centre">
        <strong
          className="cost-donut__figure"
          title={label.exact ?? undefined}
        >
          {label.headline}
        </strong>
        {label.exact ? (
          <span className="board__sr-only"> — exactly {label.exact}</span>
        ) : null}
        <span className="cost-donut__caption">{label.caption}</span>
      </div>
    </div>
  );
}

/**
 * Where the budget ran out, on a ring that has already passed it.
 *
 * Drawn twice: a wide stroke in the surface colour, then the rule over it. The
 * mark's usual home is the middle of a saturated wedge, and a bare 2px red line
 * on a full-strength amber fill is the one place it disappears.
 */
function TargetNotch({ at }: { at: number }) {
  const inner = pointOnRing(at, RADIUS - THICKNESS / 2 - 1, CENTRE);
  const outer = pointOnRing(at, RADIUS + THICKNESS / 2 + 1, CENTRE);
  const ends = { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
  return (
    <>
      <line className="cost-donut__limit-halo" {...ends} />
      <line className="cost-donut__limit" {...ends} />
    </>
  );
}
