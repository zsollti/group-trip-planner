import type { CategoryView } from "@gtp/types";
import type { CostComposition, CostSlice } from "../lib/costComposition";
import { donutArcs, pointOnRing } from "../lib/donutGeometry";
import { categoryHueStyleById } from "../lib/categoryTheme";
import { centreFontRem } from "../lib/donutCentre";

/**
 * Where the trip's locked money went, as one ring.
 *
 * **A full circle is `max(spend, target)`** — one rule that reads both ways.
 * Under the target the wedges are the spend and the dark remainder is headroom;
 * past it the wedges fill the ring and the overshoot is marked along it.
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
 *
 * The hover is decoration for the same reason: it is a faster way to read the
 * list, never the only way. Every wedge's detail is in that list already, and
 * the list is what a keyboard drives — hovering a row lights the wedge exactly
 * as hovering the wedge lights the row.
 */

const SIZE = 120;
const CENTRE = SIZE / 2;
const RADIUS = 48;
const THICKNESS = 16;
/** How much a hovered wedge thickens. Enough to notice, not enough to reflow. */
const LIFT = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Matches the 2px the stacked bar puts between its segments. */
const GAP = 2.5;
/** The over-budget band sits outside the ring, clear of the wedges it measures. */
const OVER_RADIUS = RADIUS + THICKNESS / 2 + 3.5;

export function CostDonut({
  composition,
  categories,
  label,
  activeId,
  onActivate,
  write,
}: {
  composition: CostComposition;
  categories: readonly CategoryView[];
  /** The figure for the middle — the strip's own words, not re-derived here. */
  label: { headline: string; caption: string; exact?: string | null };
  /** Money as this surface writes it — exact or approximate, decided upstream. */
  write: (amount: number) => string;
  /** Which slice is being read, from either the ring or the list beside it. */
  activeId?: string | null;
  onActivate?: (categoryId: string | null | undefined) => void;
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
  const active = slices.find((s) => keyOf(s) === activeId) ?? null;

  return (
    <div className="cost-donut" onMouseLeave={() => onActivate?.(undefined)}>
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
          {slices.map((slice, i) => {
            const isActive = keyOf(slice) === activeId;
            const dimmed = activeId != null && !isActive;
            return (
              <circle
                key={keyOf(slice)}
                className={
                  "cost-donut__wedge" +
                  (slice.categoryId === null ? " cost-donut__wedge--tail" : "") +
                  (isActive ? " cost-donut__wedge--on" : "") +
                  (dimmed ? " cost-donut__wedge--off" : "")
                }
                style={categoryHueStyleById(slice.categoryId, categories)}
                cx={CENTRE}
                cy={CENTRE}
                r={RADIUS}
                strokeWidth={isActive ? THICKNESS + LIFT : THICKNESS}
                strokeDasharray={`${arcs[i]!.length} ${CIRCUMFERENCE}`}
                strokeDashoffset={-arcs[i]!.start}
                onMouseEnter={() => onActivate?.(slice.categoryId)}
              />
            );
          })}
          {/*
           * How far past the budget, as a length rather than a tick.
           *
           * It runs from where the target fell to the end of the ring, on its
           * own band **outside** the wedges. Outside, because the overshoot is
           * not a category and must not eat one: the wedges keep their true
           * shares of the spend, and this measures across them. The previous
           * mark was a single radial line at the same angle, which asked the
           * reader to know that the ring is scaled to `max(spend, target)`
           * before it meant anything — and landed mid-wedge, where it read as a
           * divider inside a lane.
           */}
          {targetMark !== null && overspend > 0 ? (
            <OverBudgetBand from={targetMark} />
          ) : null}
        </g>
        {targetMark !== null && overspend > 0 ? (
          <TargetTick at={targetMark} />
        ) : null}
      </svg>
      <Centre label={label} active={active} write={write} />
    </div>
  );
}

/** One stable key per slice; the tail has no category id to use. */
function keyOf(slice: CostSlice): string {
  return slice.categoryId ?? "tail";
}

/**
 * The stretch of the ring that is past the target.
 *
 * Drawn in the rotated group with the wedges, so it shares their clock: zero is
 * twelve, and the band starts exactly where the wedges have spent the budget.
 */
function OverBudgetBand({ from }: { from: number }) {
  const circumference = 2 * Math.PI * OVER_RADIUS;
  const span = Math.max((1 - from) * circumference, 1);
  return (
    <circle
      className="cost-donut__over"
      cx={CENTRE}
      cy={CENTRE}
      r={OVER_RADIUS}
      strokeDasharray={`${span} ${circumference}`}
      strokeDashoffset={-from * circumference}
    />
  );
}

/**
 * A short radial tick at the exact point the budget ran out.
 *
 * The band alone says "this much is over"; the tick says "from here". Kept
 * short and outside the wedges — the old full-height rule crossed a saturated
 * fill, which is where a 2px red line disappears.
 */
function TargetTick({ at }: { at: number }) {
  const inner = pointOnRing(at, RADIUS + THICKNESS / 2, CENTRE);
  const outer = pointOnRing(at, OVER_RADIUS + 3, CENTRE);
  return (
    <line
      className="cost-donut__limit"
      x1={inner.x}
      y1={inner.y}
      x2={outer.x}
      y2={outer.y}
    />
  );
}

/**
 * The hole: the trip's figure, or the lane being read.
 *
 * The size is computed rather than fixed — see {@link centreFontRem}. A six-
 * figure total with grouped thousands is twelve characters, and at the old
 * fixed size it ran straight over the ring.
 */
function Centre({
  label,
  active,
  write,
}: {
  label: { headline: string; caption: string; exact?: string | null };
  active: CostSlice | null;
  write: (amount: number) => string;
}) {
  if (active) return <ActiveCentre slice={active} write={write} />;
  return (
    <div className="cost-donut__centre">
      <strong
        className="cost-donut__figure"
        style={{ fontSize: `${centreFontRem(label.headline, 98)}rem` }}
        title={label.exact ?? undefined}
      >
        {label.headline}
      </strong>
      {label.exact ? (
        <span className="board__sr-only"> — exactly {label.exact}</span>
      ) : null}
      <span className="cost-donut__caption">{label.caption}</span>
    </div>
  );
}

/** How many of a slice's parts the hole can hold before it is a wall of text. */
const PARTS_SHOWN = 3;

/**
 * What one lane's money actually went on.
 *
 * This is the point of the hover: the ring can say a lane is a third of the
 * trip, and cannot say which decisions that third was. The parts are named
 * largest first, with the remainder counted rather than listed — a hole this
 * size cannot hold six option titles, and cutting the list off silently would
 * misreport the lane as cheaper than it is.
 */
function ActiveCentre({
  slice,
  write,
}: {
  slice: CostSlice;
  write: (amount: number) => string;
}) {
  const shown = slice.parts.slice(0, PARTS_SHOWN);
  const rest = slice.parts.length - shown.length;
  const amount = write(slice.amount);
  return (
    <div className="cost-donut__centre cost-donut__centre--active">
      <span className="cost-donut__lane">{slice.label}</span>
      <strong
        className="cost-donut__figure"
        style={{ fontSize: `${centreFontRem(amount, 98)}rem` }}
      >
        {amount}
      </strong>
      <span className="cost-donut__caption">
        {Math.round(slice.share * 100)}% of what is locked
      </span>
      <ul className="cost-donut__parts">
        {shown.map((part) => (
          <li key={part.label}>{part.label}</li>
        ))}
        {rest > 0 ? <li className="cost-donut__parts-more">+{rest} more</li> : null}
      </ul>
    </div>
  );
}
