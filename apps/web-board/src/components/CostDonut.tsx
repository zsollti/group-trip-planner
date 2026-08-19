import type { CSSProperties, ReactNode } from "react";
import type { CategoryView } from "@gtp/types";
import {
  OVER_KEY,
  REMAINING_KEY,
  type CostComposition,
  type CostSlice,
} from "../lib/costComposition";
import { donutArcs, pointOnRing } from "../lib/donutGeometry";
import { categoryHueStyleById, categoryIconKey } from "../lib/categoryTheme";
import { MARK_PATHS } from "../lib/categoryIconPaths";
import {
  centreFontRem,
  centreLabelRem,
  HOLE_FRACTION,
  HOLE_PX,
  LABEL_PX,
} from "../lib/donutCentre";
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
/** The over-budget band's stroke at rest; see {@link OVER_LIFT} for what it
 *  gains when the band is being read. */
const OVER_WIDTH_BASE = 5;
/**
 * How far the over-budget band clears the wedges it measures.
 *
 * The **same gap two wedges leave between them**, and named against `GAP` rather
 * than typed as its own number so it stays that way. It was 1 unit — the band
 * sat all but touching the ring, which read as a rim on the wedges instead of a
 * separate mark, and the moment it thickened under the pointer it closed even
 * that.
 */
const OVER_GAP = GAP;
/** The over-budget band sits outside the ring, clear of the wedges it measures. */
const OVER_RADIUS = RADIUS + THICKNESS / 2 + OVER_GAP + OVER_WIDTH_BASE / 2;
/**
 * How thick that band is, and how much of that it gains when it is read.
 *
 * **It grows by a wedge's {@link LIFT}, like everything else on this ring** —
 * the band used to gain 2 where a wedge gains 5, so pointing at the one mark
 * that answers "how far over?" moved it least of all. It could not simply be
 * raised: a stroke grows about its own centreline, so five each way would have
 * eaten into the gap above and reached outside the viewBox.
 *
 * So the band grows **outwards only** — {@link overBand} pushes its radius out
 * by half the lift as it widens by the whole of it. The gap under it is
 * therefore constant, and the growth is a wedge's.
 *
 * Here rather than in the stylesheet because the lift is an attribute, and a
 * `stroke-width` in CSS wins against one.
 */
const OVER_LIFT = LIFT;
/**
 * The outermost ink on this chart: the over-budget band at its widest, plus half
 * its stroke.
 *
 * Worth naming, because it was once 63.75 in a box whose edge is at 60 — the
 * band was being **clipped by the viewBox**, which is why the red arc came out
 * with its top flattened. Nothing about the band was wrong; there was simply no
 * canvas where it was drawn. Derived from the band's own numbers, so thickening
 * it under the pointer cannot quietly bring that back.
 */
const OUTERMOST =
  OVER_RADIUS + OVER_LIFT / 2 + (OVER_WIDTH_BASE + OVER_LIFT) / 2;
/** How far the box has to grow on each side to hold {@link OUTERMOST}. */
const VIEW_PAD = Math.max(0, Math.ceil(OUTERMOST - CENTRE));
/**
 * The drawing box, which is the ring's own box plus that bleed.
 *
 * Derived rather than typed in, so moving the band outwards can never silently
 * crop it again — and `HOLE_FRACTION` divides by this, since the hole is a
 * share of what is drawn rather than of the ring alone.
 */
const VIEW = SIZE + 2 * VIEW_PAD;
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
  const readingOver = activeId === OVER_KEY && overspend > 0;

  return (
    <div
      className="cost-donut"
      /* The hole's width as a share of the box, so the middle is positioned by
         the same arithmetic that draws the ring. It was a hand-computed 17% in
         the stylesheet, which was right for a 120 box and wrong the moment the
         box grew to hold the over-budget band. */
      style={{ "--donut-hole": `${HOLE_FRACTION * 100}%` } as CSSProperties}
      onMouseLeave={() => onActivate?.(undefined)}
    >
      <svg
        className="cost-donut__ring"
        viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${VIEW} ${VIEW}`}
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
            <OverBudgetBand
              from={targetMark}
              active={readingOver}
              dimmed={activeId != null && !readingOver}
              onActivate={onActivate}
            />
          ) : null}
        </g>
        {/*
         * Each lane's own mark, on its own wedge.
         *
         * Outside the rotated group: `pointOnRing` already puts zero at twelve
         * o'clock, so a glyph placed by it inside the group would be turned a
         * further quarter-turn onto its side.
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
        {/* The remainder's own mark, on the same rule as a lane's — and now in
            the same white, which is the rule it was the one exception to. It
            wore the dim ink because the grey under it was too pale to hold
            anything lighter; the grey is a step darker now, so the exception
            has no reason left and the ring's marks are one set again. */}
        {headroom >= MARK_MIN_ARC / CIRCUMFERENCE ? (
          <WedgeMark
            at={drawn + headroom / 2}
            path={MARK_PATHS.REMAINING}
            dimmed={activeId != null && !readingRemainder}
          />
        ) : null}
      </svg>
      <Centre
        label={label}
        active={active}
        remaining={readingRemainder ? composition.remaining : null}
        over={readingOver ? overspend : null}
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
    <div
      className="cost-donut"
      style={{ "--donut-hole": `${HOLE_FRACTION * 100}%` } as CSSProperties}
    >
      <svg
        className="cost-donut__ring"
        viewBox={`${-VIEW_PAD} ${-VIEW_PAD} ${VIEW} ${VIEW}`}
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
          style={{ fontSize: `${centreFontRem(label.headline, HOLE_PX)}rem` }}
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
}: {
  at: number;
  path: ReactNode;
  dimmed: boolean;
}) {
  const { x, y } = pointOnRing(at, RADIUS, CENTRE);
  const scale = MARK / 24;
  return (
    <g
      className={"cost-donut__mark" + (dimmed ? " cost-donut__mark--off" : "")}
      transform={`translate(${x - MARK / 2} ${y - MARK / 2}) scale(${scale})`}
    >
      {path}
    </g>
  );
}

/**
 * The band's geometry for a given state, as one place both the radius and the
 * dash arithmetic are read from.
 *
 * Together, because they are one fact: a dash length is a fraction of *its own*
 * circle's circumference, so a band that moves outwards when it is read has to
 * re-measure the circle it is dashed around, or the arc it draws grows with the
 * radius and the mark stops meaning "this far past the target".
 *
 * **Growing outwards is what buys the wedge-sized lift** — see {@link OVER_LIFT}.
 * A stroke thickens about its centreline, so pushing the centreline out by half
 * the lift while widening by the whole of it leaves the inner edge exactly where
 * it was, and the gap over the wedges constant.
 */
function overBand(active: boolean) {
  const radius = OVER_RADIUS + (active ? OVER_LIFT / 2 : 0);
  return {
    radius,
    width: OVER_WIDTH_BASE + (active ? OVER_LIFT : 0),
    circumference: 2 * Math.PI * radius,
  };
}

/**
 * The stretch of the ring that is past the target.
 *
 * Drawn in the rotated group with the wedges, so it shares their clock: zero is
 * twelve.
 *
 * **It starts at twelve and runs clockwise**, the way every wedge under it does,
 * and its length is the overshoot. It used to *end* at twelve instead — starting
 * at the angle the budget ran out and running to the top — which is the same
 * length in the other direction, and it made this the one mark on the chart that
 * grew backwards. Reading a ring means starting at twelve, and the eye should
 * not have to reverse for one arc. What is lost is that the band no longer
 * begins over the wedge that spent the last of the budget; what is gained is
 * that its start is fixed, so consecutive readings of the same board differ only
 * in how far round the red goes.
 *
 * **Readable like a wedge**, because a reader points at it like one. It was the
 * last mark on this chart that did nothing under the pointer — and the only one
 * whose figure the hole never printed, so "how far over are we" was a question
 * the drawing raised and left to the list to answer.
 */
function OverBudgetBand({
  from,
  active,
  dimmed,
  onActivate,
}: {
  from: number;
  active: boolean;
  dimmed: boolean;
  onActivate?: (key: string | undefined) => void;
}) {
  const { radius, width, circumference } = overBand(active);
  const span = Math.max((1 - from) * circumference, 1);
  return (
    <circle
      className={
        "cost-donut__over" +
        (active ? " cost-donut__over--on" : "") +
        (dimmed ? " cost-donut__over--off" : "")
      }
      cx={CENTRE}
      cy={CENTRE}
      r={radius}
      strokeWidth={width}
      strokeDasharray={`${span} ${circumference}`}
      onMouseEnter={() => onActivate?.(OVER_KEY)}
    />
  );
}

/*
 * A short radial tick marked where the budget ran out — "this much is over"
 * from the band, "from here" from the tick.
 *
 * Removed. The band's own end *is* the point the budget ran out, so the tick
 * drew that boundary a second time and drew it sticking out of the arc: a clean
 * red line with one stray mark on one end of it. What it was really
 * compensating for — a length nobody could interrogate — is answered properly
 * now, by the band saying in the middle of the ring how much it is measuring.
 */

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
  over,
  write,
}: {
  label: { headline: string; caption: string; exact?: string | null };
  active: CostSlice | null;
  /** Money still inside the target, when that is the part being read. */
  remaining: number | null;
  /** Money past the target, when *that* is the part being read. */
  over: number | null;
  write: (amount: number) => string;
}) {
  if (active) return <ActiveCentre slice={active} write={write} />;
  if (remaining !== null)
    return <RemainingCentre amount={remaining} write={write} />;
  if (over !== null) return <OverCentre amount={over} write={write} />;
  return (
    <div className="cost-donut__centre">
      <strong
        className="cost-donut__figure"
        style={{ fontSize: `${centreFontRem(label.headline, HOLE_PX)}rem` }}
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
 * The line above the figure: which part of the ring is being read.
 *
 * Sized to fit rather than set at a fixed 0.6rem, and fitted against a width
 * **narrower than the hole** — see {@link LABEL_PX}. The centre is a square
 * inset to the hole's diameter while the hole is a circle, so a name on the
 * line above the middle had the full diameter to spread into and the circle had
 * already narrowed by then. "Accommodation" duly ran into the wedges on both
 * sides, which is what the reader sees as the text touching the chart.
 *
 * Not upper-cased any more either, and that is half the fix: capitals plus the
 * tracking they needed cost about a fifth of the line's width for no
 * information, and the lane is called "Accommodation" everywhere else in the
 * app. Written the way it is written, it fits.
 */
function CentreLane({ children }: { children: string }) {
  return (
    <span
      className="cost-donut__lane"
      style={{ fontSize: `${centreLabelRem(children, LABEL_PX)}rem` }}
    >
      {children}
    </span>
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
      <CentreLane>{t("Still to spend")}</CentreLane>
      {/* Green, alone among the figures this hole prints. Every other one is a
          quantity — this lane cost that much — and this one is a verdict: there
          is still room. It reads against the red the same surface uses for the
          overshoot, which is what makes the pair a scale rather than two moods. */}
      <strong
        className="cost-donut__figure cost-donut__figure--ok"
        style={{ fontSize: `${centreFontRem(written, HOLE_PX)}rem` }}
      >
        {written}
      </strong>
    </div>
  );
}

/**
 * How far past the target, in the hole.
 *
 * The same three-line shape as the remainder's, because it is the same question
 * answered from the other side of the budget: the green says how much room is
 * left, the red how much room was needed. Between them they are a scale, which
 * is why neither is a colour this hole uses for anything else.
 */
function OverCentre({
  amount,
  write,
}: {
  amount: number;
  write: (n: number) => string;
}) {
  const written = write(amount);
  return (
    <div className="cost-donut__centre cost-donut__centre--active">
      <CentreLane>{t("Over budget")}</CentreLane>
      <strong
        className="cost-donut__figure cost-donut__figure--over"
        style={{ fontSize: `${centreFontRem(written, HOLE_PX)}rem` }}
      >
        {written}
      </strong>
    </div>
  );
}

/**
 * One lane's money, in the hole.
 *
 * **The lane and its figure, and nothing else.** It used to name the decisions
 * behind the figure too — three of them, with the rest counted — on the
 * reasoning that the ring raises a question ("which third is that?") it cannot
 * itself answer. In use the answer was the wrong size for the place it was
 * given: a stack of option titles at 0.56rem inside a 78px hole, appearing and
 * vanishing under the pointer, which is a list you cannot read rather than a
 * detail you can. The reader who wants the decisions has the lane in front of
 * them on the board.
 *
 * So the hover says exactly what the wedge is: this lane, this much. Two lines
 * and no third — the share went the same way, and for the same reason, when the
 * hole was last trimmed: the wedge in front of the reader already *is* the
 * share, and the row being hovered prints the percentage.
 */
function ActiveCentre({
  slice,
  write,
}: {
  slice: CostSlice;
  write: (amount: number) => string;
}) {
  const amount = write(slice.amount);
  return (
    <div className="cost-donut__centre cost-donut__centre--active">
      <CentreLane>{slice.label}</CentreLane>
      <strong
        className="cost-donut__figure"
        style={{ fontSize: `${centreFontRem(amount, HOLE_PX)}rem` }}
      >
        {amount}
      </strong>
    </div>
  );
}
