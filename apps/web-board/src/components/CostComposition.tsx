import { useState } from "react";
import type { CategoryView } from "@gtp/types";
import {
  OVER_KEY,
  REMAINING_KEY,
  sliceKey,
  type CostComposition as Composition,
  type CostSlice,
} from "../lib/costComposition";
import { categoryHueStyleById } from "../lib/categoryTheme";
import { CostDonut } from "./CostDonut";
import { PersonStack } from "./PersonStack";
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";
import { t } from "../lib/i18n";

/**
 * The cost composition: the ring, the lanes that make it up, and what it
 * deliberately leaves out.
 *
 * This shipped as a **choice of two drawings** of one {@link Composition} — a
 * donut and a stacked bar, picked per browser — on the reasoning that a length
 * is easier to compare than an angle and the preference is a matter of taste.
 * In use it was neither: one surface, two shapes, and a control asking a
 * question nobody had. The donut is the one the board kept, and the model it
 * draws is unchanged, so the bar can come back from history if it is ever
 * wanted.
 *
 * The ring is optional decoration in the strict sense — the list beneath names
 * every lane with its amount and share, which is the accessible version and the
 * one that survives a reader who cannot separate two of the board's hues.
 */
export function CostComposition({
  composition,
  categories,
  headline,
  myUserId,
}: {
  composition: Composition;
  categories: readonly CategoryView[];
  /** The reader, so their own face is ringed in the excluded aside. */
  myUserId: string | undefined;
  /**
   * The per-person figure this surface states once, plus `exact`: the exact
   * per-currency sums behind it when it is approximate. `exact` is a tooltip
   * and screen-reader text rather than a line of its own — see `CostTally`.
   */
  headline: { headline: string; caption: string; exact?: string | null };
}) {
  /**
   * Which slice the reader is on, shared by the ring and the list.
   *
   * It lives here rather than in either of them because both are two views of
   * the same row: hovering a wedge lights its line, hovering a line lifts its
   * wedge. Two local states would let them disagree, which is the one thing a
   * chart and its legend must never do.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const activate = (key: string | undefined) => setActiveId(key ?? null);

  const write = (n: number) =>
    composition.approximate
      ? approx(n, composition.currency)
      : money(n, composition.currency);

  return (
    <section className="cost-comp">
      <header className="cost-comp__head">
        <h3 className="cost-comp__title">{t("Where it goes")}</h3>
      </header>

      <div className="cost-comp__chart">
        <CostDonut
          composition={composition}
          categories={categories}
          label={headline}
          write={write}
          activeId={activeId}
          onActivate={activate}
        />
      </div>

      <CostLegend
        composition={composition}
        categories={categories}
        write={write}
        activeId={activeId}
        onActivate={activate}
      />
      {/* The overshoot had a paragraph of its own here — "€107 over target, per
          person · 21% above it" — directly under a row that already named it.
          Both figures live on that row now, so the sentence was the same
          reading twice, in prose, in the place a summary should be shortest. */}
      <Excluded composition={composition} myUserId={myUserId} />
      <Uncounted composition={composition} />
    </section>
  );
}

/**
 * Every lane, named, with what it costs and what fraction of the circle it is.
 *
 * This is the legend, the direct labels and the table view at once, and it is
 * why either chart can be `aria-hidden`. Shares are quoted against the whole
 * circle — the same denominator the wedges use — so the numbers here and the
 * angles above cannot tell different stories.
 */
function CostLegend({
  composition,
  categories,
  write,
  activeId,
  onActivate,
}: {
  composition: Composition;
  categories: readonly CategoryView[];
  write: (amount: number) => string;
  activeId: string | null;
  onActivate: (key: string | undefined) => void;
}) {
  const { slices, overspend, overshare, remaining, full } = composition;

  return (
    <ul className="cost-comp__legend">
      {slices.map((slice) => (
        <LegendRow
          key={sliceKey(slice)}
          slice={slice}
          categories={categories}
          write={write}
          active={sliceKey(slice) === activeId}
          onActivate={onActivate}
        />
      ))}
      {/*
       * What is left, as a row of the breakdown.
       *
       * The ring's grey arc is now readable, and this is what makes that true
       * rather than mouse-only: the chart is `aria-hidden` decoration, so a part
       * that can only be reached by pointing at it cannot be reached at all by
       * a keyboard or a screen reader. Every other part of the circle earns its
       * row here; so does this one.
       */}
      {remaining > 0 ? (
        <RemainingRow
          amount={remaining}
          share={full > 0 ? remaining / full : 0}
          write={write}
          active={activeId === REMAINING_KEY}
          onActivate={onActivate}
        />
      ) : null}
      {/*
       * The overshoot as a row of the breakdown, not a footnote under it.
       *
       * The ring now draws it as a length, and a length on a chart with no
       * matching line in the list is the kind of mark a reader has to guess at
       * — which is exactly what was wrong with the tick it replaced. It carries
       * no share: it is not a part of the circle, it is how far the circle went
       * past the budget.
       */}
      {overspend > 0 ? (
        <li
          className={
            "cost-comp__row cost-comp__row--over" +
            (activeId === OVER_KEY ? " cost-comp__row--on" : "")
          }
        >
          {/*
           * A button now, like every other row.
           *
           * It was a `div` wearing the button's class — the right call while
           * the band on the ring was inert, because a focus stop that lights
           * nothing up is a promise the chart could not keep. The band reads
           * like a wedge now, so this row has a part to light and the keyboard
           * has a way to reach it: the ring is `aria-hidden` decoration, so a
           * part reachable only by pointing at it is not reachable at all.
           */}
          <button
            type="button"
            className="cost-comp__row-btn"
            onMouseEnter={() => onActivate(OVER_KEY)}
            onMouseLeave={() => onActivate(undefined)}
            onFocus={() => onActivate(OVER_KEY)}
            onBlur={() => onActivate(undefined)}
          >
            <span
              className="cost-comp__swatch cost-comp__swatch--over"
              aria-hidden="true"
            />
            <span className="cost-comp__name">{t("Over budget")}</span>
            {/*
             * The share here is of the **target**, not of the circle — this is
             * not a part of the ring, it is how far the ring went past the
             * budget. It moved up from a paragraph under the list that said the
             * same two numbers in a sentence; one row saying "Over budget · 21%
             * · 107 EUR" is the same information in the place the eye is
             * already reading figures.
             */}
            <span className="cost-comp__share">
              {Math.round(overshare * 100)}%
            </span>
            <span className="cost-comp__amount">{write(overspend)}</span>
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * One lane in the breakdown, and the keyboard's way into the chart.
 *
 * A button rather than a list item with handlers, because this is the path a
 * keyboard takes: the ring is `aria-hidden` decoration, so if focusing a lane
 * were not possible here it would not be possible at all, and the hover would
 * be a mouse-only feature dressed up as an affordance.
 */
function LegendRow({
  slice,
  categories,
  write,
  active,
  onActivate,
}: {
  slice: CostSlice;
  categories: readonly CategoryView[];
  write: (amount: number) => string;
  active: boolean;
  onActivate: (key: string | undefined) => void;
}) {
  return (
    <li className={"cost-comp__row" + (active ? " cost-comp__row--on" : "")}>
      <button
        type="button"
        className="cost-comp__row-btn"
        onMouseEnter={() => onActivate(sliceKey(slice))}
        onMouseLeave={() => onActivate(undefined)}
        onFocus={() => onActivate(sliceKey(slice))}
        onBlur={() => onActivate(undefined)}
      >
        <span
          className={
            "cost-comp__swatch" +
            (slice.categoryId === null ? " cost-comp__swatch--tail" : "")
          }
          style={categoryHueStyleById(slice.categoryId, categories)}
          aria-hidden="true"
        />
        <span className="cost-comp__name">{slice.label}</span>
        <span className="cost-comp__share">
          {Math.round(slice.share * 100)}%
        </span>
        <span className="cost-comp__amount">{write(slice.amount)}</span>
      </button>
    </li>
  );
}

/**
 * The remainder's row: same shape as a lane's, deliberately.
 *
 * It is not a lane and its swatch says so — the neutral grey the arc itself
 * wears — but everything else about it is a lane row, because a reader
 * comparing "Stay 43%" with "Still to spend 12%" is comparing two parts of one
 * circle and the row should not make that harder than the ring does.
 */
function RemainingRow({
  amount,
  share,
  write,
  active,
  onActivate,
}: {
  amount: number;
  share: number;
  write: (amount: number) => string;
  active: boolean;
  onActivate: (key: string | undefined) => void;
}) {
  return (
    <li
      className={
        "cost-comp__row cost-comp__row--left" +
        (active ? " cost-comp__row--on" : "")
      }
    >
      <button
        type="button"
        className="cost-comp__row-btn"
        onMouseEnter={() => onActivate(REMAINING_KEY)}
        onMouseLeave={() => onActivate(undefined)}
        onFocus={() => onActivate(REMAINING_KEY)}
        onBlur={() => onActivate(undefined)}
      >
        <span
          className="cost-comp__swatch cost-comp__swatch--left"
          aria-hidden="true"
        />
        <span className="cost-comp__name">{t("Still to spend")}</span>
        <span className="cost-comp__share">{Math.round(share * 100)}%</span>
        <span className="cost-comp__amount">{write(amount)}</span>
      </button>
    </li>
  );
}

/**
 * Locked money the ring cannot honestly hold.
 *
 * An option priced for part of the group has a per-person figure divided by a
 * different number of people, so it cannot join a per-person total without
 * making one nobody pays. It is named here instead, in its own currency and
 * with the headcount it was priced for, so the money is visible even though it
 * is not drawable.
 *
 * **The reader's own are marked.** The chart states what everyone shares while
 * the target beneath it states what *you* owe, and those legitimately differ the
 * moment you join one of these. Without a mark the two figures look like a
 * contradiction; with one, this aside is the arithmetic between them.
 */
function Excluded({
  composition,
  myUserId,
}: {
  composition: Composition;
  /** Whose face to ring — the reader's, when they are one of the people the
   *  option is priced for. */
  myUserId: string | undefined;
}) {
  const { excluded } = composition;
  if (excluded.length === 0) return null;
  return (
    <div className="cost-comp__aside">
      <p className="cost-comp__aside-head">
        {t("Priced for part of the group")}
      </p>
      <ul className="cost-comp__aside-list">
        {excluded.map((e) => (
          <li key={e.optionId}>
            <span className="cost-comp__aside-name">{e.title}</span>{" "}
            <strong>{money(e.perPerson, e.currency)}</strong> {t("per person")}
            {/* Faces rather than "for 4 members · yours". The count answered a
                question nobody standing here asks: what a reader wants of an
                option priced for part of the group is *who* — and whether that
                is them — which is what the board draws people as everywhere
                else it names them. Their own face is ringed, which says
                "yours" in the place the eye is already looking instead of in a
                clause after the number. */}
            <PersonStack
              people={e.participants}
              mine={e.viewerOwes ? myUserId : undefined}
              label={t("{n} in — see who", { n: e.participants.length })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Currencies no rate reached, so nothing above accounts for them. */
function Uncounted({ composition }: { composition: Composition }) {
  const { uncounted } = composition;
  if (uncounted.length === 0) return null;
  return (
    <p className="cost-comp__uncounted">
      {t("{currencies} not counted — no rate to convert with", {
        currencies: uncounted.join(", "),
      })}
    </p>
  );
}
