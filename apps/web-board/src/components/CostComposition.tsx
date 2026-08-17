import { useState } from "react";
import type { CategoryView } from "@gtp/types";
import type {
  CostComposition as Composition,
  CostSlice,
} from "../lib/costComposition";
import { categoryHueStyleById } from "../lib/categoryTheme";
import { CostDonut } from "./CostDonut";
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";
import { plural, t, tNode } from "../lib/i18n";

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
}: {
  composition: Composition;
  categories: readonly CategoryView[];
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
  const activate = (categoryId: string | null | undefined) =>
    setActiveId(categoryId === undefined ? null : (categoryId ?? "tail"));

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
      <Overshoot composition={composition} />
      <Excluded composition={composition} />
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
  onActivate: (categoryId: string | null | undefined) => void;
}) {
  const { slices, overspend } = composition;

  return (
    <ul className="cost-comp__legend">
      {slices.map((slice) => (
        <LegendRow
          key={slice.categoryId ?? "tail"}
          slice={slice}
          categories={categories}
          write={write}
          active={(slice.categoryId ?? "tail") === activeId}
          onActivate={onActivate}
        />
      ))}
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
        <li className="cost-comp__row cost-comp__row--over">
          <span
            className="cost-comp__swatch cost-comp__swatch--over"
            aria-hidden="true"
          />
          <span className="cost-comp__name">{t("Over budget")}</span>
          <span className="cost-comp__share" />
          <span className="cost-comp__amount">{write(overspend)}</span>
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
  onActivate: (categoryId: string | null | undefined) => void;
}) {
  return (
    <li className={"cost-comp__row" + (active ? t(" cost-comp__row--on") : "")}>
      <button
        type="button"
        className="cost-comp__row-btn"
        onMouseEnter={() => onActivate(slice.categoryId)}
        onMouseLeave={() => onActivate(undefined)}
        onFocus={() => onActivate(slice.categoryId)}
        onBlur={() => onActivate(undefined)}
      >
        <span
          className={
            "cost-comp__swatch" +
            (slice.categoryId === null ? t(" cost-comp__swatch--tail") : "")
          }
          style={categoryHueStyleById(slice.categoryId, categories)}
          aria-hidden="true"
        />
        <span className="cost-comp__name">{slice.label}</span>
        <span className="cost-comp__share">
          {Math.round(slice.share * 100)}%
        </span>
        <span className="cost-comp__amount">{write(slice.amount)}</span>
        {/*
         * What the lane's money went on, for a reader who cannot see the hole.
         *
         * Not rendered visibly here on purpose: focusing this row already puts
         * the parts in the middle of the ring, and printing them twice on one
         * screen would be the legend competing with the chart it explains.
         * This copy is the same facts routed to the one reader the visual
         * version never reaches, and it is always in the DOM rather than
         * revealed, so it belongs to the button's description on focus instead
         * of appearing out of nowhere.
         */}
        {slice.parts.length > 0 ? (
          <span className="board__sr-only">
            {" — "}
            {slice.parts
              .map((part) => `${part.label} ${write(part.amount)}`)
              .join(", ")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** How far past the target, in money and as a fraction of it. */
function Overshoot({ composition }: { composition: Composition }) {
  const { overspend, overshare, currency, approximate } = composition;
  if (overspend <= 0) return null;
  const amount = approximate
    ? approx(overspend, currency)
    : money(overspend, currency);
  return (
    <p className="cost-comp__over" role="status">
      {tNode("{amount} over target, per person", {
        amount: <strong>{amount}</strong>,
      })}
      <span className="cost-comp__over-pct">
        {" "}
        {t("· {percent}% above it", {
          percent: Math.round(overshare * 100),
        })}
      </span>
    </p>
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
function Excluded({ composition }: { composition: Composition }) {
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
            {tNode("{amount} per person for {who}", {
              amount: <strong>{money(e.perPerson, e.currency)}</strong>,
              who: plural(e.headcount, "{n} member", "{n} members"),
            })}
            {e.viewerOwes ? (
              <span className="cost-comp__aside-mine"> {t("· yours")}</span>
            ) : null}
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
