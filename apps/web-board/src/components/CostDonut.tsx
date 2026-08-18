import type { ReactNode } from "react";
import type { CategoryView } from "@gtp/types";
import {
  REMAINING_KEY,
  type CostComposition,
  type CostSlice,
} from "../lib/costComposition";
import { donutArcs, pointOnRing } from "../lib/donutGeometry";
import { categoryHueStyleById, categoryIconKey } from "../lib/categoryTheme";
import { MARK_PATHS } from "../lib/categoryIconPaths";
import { centreFontRem } from "../lib/donutCentre";
import { t } from "../lib/i18n";

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
/**
 * How big a lane's mark is drawn on its own wedge, in the ring's own units.
 *
 * Comfortably inside {@link THICKNESS} so the glyph sits *in* the band rather
 * than straddling its edges, which is what would make it read as a sticker
 * dropped on the chart instead of part of it.
 */
const MARK = 12;
/**
 * The shortest wedge that still gets its mark.
 *
 * "Enough space" measured along the arc, not by share, because a share is a
 * fraction and the thing that has to fit is a length. A wedge shorter than the
 * glyph plus a little air renders it touching both its neighbours, and three
 * marks crammed into a tenth of the ring is noise where the list beside it is
 * already saying the same thing in words.
 */
const MARK_MIN_ARC = MARK + 6;

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
  /**
   * Which part is being read, from either the ring or the list beside it, by
   * the shared key — see `sliceKey`. `undefined` from a handler means "nothing".
   */
  activeId?: string | null;
  onActivate?: (key: string | undefined) => void;
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
  const readingRemainder = activeId === REMAINING_KEY && headroom > 0;

  return (
    <div className="cost-donut" onMouseLeave={() => onActivate?.(undefined)}>
      <svg
        className="cost-donut__ring"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <g transform={`rotate(-90 ${CENTRE} ${CENTRE})`}>
          {/*
           * The money still inside the target — a part of the circle like any
           * other, and now readable like one.
           *
           * It was the one stretch of the ring that did nothing on hover, which
           * made it read as background rather than as an answer. It is neither:
           * it is the single most actionable figure on this surface ("how much
           * can we still spend?"), and the reader was being asked to subtract
           * to get it.
           */}
          {headroom > 0 ? (
            <circle
              className={
                "cost-donut__headroom" +
                (readingRemainder ? " cost-donut__headroom--on" : "") +
                (activeId != null && !readingRemainder
                  ? " cost-donut__headroom--off"
                  : "")
              }
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS}
              strokeWidth={readingRemainder ? THICKNESS + LIFT : THICKNESS}
              strokeDasharray={`${Math.max(headroom * CIRCUMFERENCE - GAP, 0)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-drawn * CIRCUMFERENCE}
              onMouseEnter={() => onActivate?.(REMAINING_KEY)}
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
                  (slice.categoryId === null
                    ? " cost-donut__wedge--tail"
                    : "") +
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
                onMouseEnter={() => onActivate?.(keyOf(slice))}
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
        {/*
         * Each lane's own mark, on its own wedge.
         *
         * Outside the rotated group, like {@link TargetTick}: `pointOnRing`
         * already puts zero at twelve o'clock, so a glyph placed by it inside
         * the group would be turned a further quarter-turn onto its side.
         *
         * Decoration, and only ever that — it is `aria-hidden` with the rest of
         * the ring, and the wedge it marks is already named in the list beside
         * the chart. A wedge too short to hold one loses nothing.
         */}
        {slices.map((slice, i) => {
          if (slice.categoryId === null) return null;
          if (arcs[i]!.length < MARK_MIN_ARC) return null;
          const category = categories.find((c) => c.id === slice.categoryId);
          if (!category) return null;
          // The arc's own start, back in fractions of the circle — the wedges
          // advance by their full share, so `start / circumference` is exactly
          // how much of the ring came before this one.
          const mid = arcs[i]!.start / CIRCUMFERENCE + slice.share / 2;
          return (
            <WedgeMark
              key={keyOf(slice)}
              at={mid}
              path={MARK_PATHS[categoryIconKey(category)]}
              dimmed={activeId != null && keyOf(slice) !== activeId}
            />
          );
        })}
        {/* The remainder's own mark, on the same rule as a lane's. */}
        {headroom >= MARK_MIN_ARC / CIRCUMFERENCE ? (
          <WedgeMark
            at={drawn + headroom / 2}
            path={MARK_PATHS.REMAINING}
            className="cost-donut__mark--quiet"
            dimmed={activeId != null && !readingRemainder}
          />
        ) : null}
        {targetMark !== null && overspend > 0 ? (
          <TargetTick at={targetMark} />
        ) : null}
      </svg>
      <Centre
        label={label}
        active={active}
        remaining={readingRemainder ? composition.remaining : null}
        write={write}
      />
    </div>
  );
}

/**
 * The same ring with nothing in it — one unbroken grey circle.
 *
 * The cost strip has two states where there is no composition to draw: a trip
 * that has locked nothing yet, and one whose locked money cannot be charted
 * (priced in a currency no rate reaches the trip's own, or priced at zero). Both
 * used to fall through to a **bar** — which, with nothing to fill it, rendered
 * as an empty track next to a figure of zero. An empty bar reads as a broken
 * chart rather than as an empty one, and it put a second, differently shaped
 * picture on a surface whose chart is a ring.
 *
 * So the shape is constant and only its content varies: the ring is always
 * there, and grey all the way round means the money has not been decided yet.
 * It reuses the wedges' own headroom colour, so "not spent" looks the same here
 * as it does on a ring that is partly filled.
 */
export function EmptyCostDonut({
  label,
}: {
  label: { headline: string; caption: string };
}) {
  return (
    <div className="cost-donut">
      <svg
        className="cost-donut__ring"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="cost-donut__headroom"
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          strokeWidth={THICKNESS}
        />
      </svg>
      <div className="cost-donut__centre">
        <strong
          className="cost-donut__figure"
          style={{ fontSize: `${centreFontRem(label.headline, 98)}rem` }}
        >
          {label.headline}
        </strong>
        <span className="cost-donut__caption">{label.caption}</span>
      </div>
    </div>
  );
}

/** One stable key per slice; the tail has no category id to use. */
function keyOf(slice: CostSlice): string {
  return slice.categoryId ?? "tail";
}

/**
 * One category's glyph, centred on its wedge.
 *
 * The paths are {@link CATEGORY_ICON_PATHS} rather than a `<CategoryIcon>`,
 * because that component is an `<svg>` of its own and this has to be a group
 * inside the chart's. Same drawing either way — which is the point of keeping
 * one set of paths: the mark on the ring is the mark on the lane header.
 *
 * White, not the lane's ink. Every wedge is a saturated field of its own hue,
 * and a per-hue foreground would need eight contrast checks that the token
 * contract does not make; white clears every one of the eight in both themes,
 * because the fill under it is `--cat-main` in either. This is also the only
 * place on the board where something is drawn *on* a category's colour, which
 * is why it is a shape and never a word.
 */
function WedgeMark({
  at,
  path,
  dimmed,
  className,
}: {
  at: number;
  path: ReactNode;
  dimmed: boolean;
  /** An extra class, for a mark that is not sitting on a lane's colour. */
  className?: string;
}) {
  const { x, y } = pointOnRing(at, RADIUS, CENTRE);
  const scale = MARK / 24;
  return (
    <g
      className={
        "cost-donut__mark" +
        (dimmed ? " cost-donut__mark--off" : "") +
        (className ? ` ${className}` : "")
      }
      transform={`translate(${x - MARK / 2} ${y - MARK / 2}) scale(${scale})`}
    >
      {path}
    </g>
  );
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
  remaining,
  write,
}: {
  label: { headline: string; caption: string; exact?: string | null };
  active: CostSlice | null;
  /** Money still inside the target, when that is the part being read. */
  remaining: number | null;
  write: (amount: number) => string;
}) {
  if (active) return <ActiveCentre slice={active} write={write} />;
  if (remaining !== null)
    return <RemainingCentre amount={remaining} write={write} />;
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
        <span className="board__sr-only">
          {" "}
          {t("— exactly {amount}", { amount: label.exact })}
        </span>
      ) : null}
      <span className="cost-donut__caption">{label.caption}</span>
    </div>
  );
}

/**
 * What is left to spend, in the hole.
 *
 * Deliberately the same three-line shape as a lane's — eyebrow, figure, caption
 * — because it is the same *kind* of answer about a different part of the same
 * circle. It has no parts list, and should not: a lane's parts are the decisions
 * behind it, and there are no decisions behind money nobody has spent.
 */
function RemainingCentre({
  amount,
  write,
}: {
  amount: number;
  write: (n: number) => string;
}) {
  const written = write(amount);
  return (
    <div className="cost-donut__centre cost-donut__centre--active">
      <span className="cost-donut__lane">{t("Still to spend")}</span>
      <strong
        className="cost-donut__figure"
        style={{ fontSize: `${centreFontRem(written, 98)}rem` }}
      >
        {written}
      </strong>
      <span className="cost-donut__caption">{t("before the target")}</span>
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
      <ul className="cost-donut__parts">
        {shown.map((part) => (
          <li key={part.label}>{part.label}</li>
        ))}
        {rest > 0 ? (
          <li className="cost-donut__parts-more">
            {t("+{n} more", { n: rest })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
