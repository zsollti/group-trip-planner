import type { CategoryView } from "@gtp/types";
import type { CostComposition as Composition } from "../lib/costComposition";
import { categoryHueStyleById } from "../lib/categoryTheme";
import { useCostChartForm, type CostChartForm } from "../lib/costChartForm";
import { CostDonut } from "./CostDonut";
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";

/**
 * The cost composition: one chart, the lanes that make it up, and what it
 * deliberately leaves out.
 *
 * The chart is a **choice of two drawings of one model** ({@link Composition}),
 * so a donut and a bar of the same trip can never disagree. Both are optional
 * decoration in the strict sense — the list beneath names every lane with its
 * amount and share, which is the accessible version and the one that survives a
 * reader who cannot separate two of the board's hues.
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
  const [form, setForm] = useCostChartForm();

  return (
    <section className="cost-comp">
      <header className="cost-comp__head">
        <h3 className="cost-comp__title">Where it goes</h3>
        <FormToggle form={form} onChange={setForm} />
      </header>

      {form === "donut" ? (
        <div className="cost-comp__chart">
          <CostDonut
            composition={composition}
            categories={categories}
            label={headline}
          />
        </div>
      ) : (
        // The bar has no hole to put the figure in, so it takes the caption the
        // donut writes in its middle. Either way the per-person total is stated
        // exactly once on this surface.
        <div className="cost-comp__stack">
          <p className="cost-comp__stack-figure">
            <strong title={headline.exact ?? undefined}>
              {headline.headline}
            </strong>
            {headline.exact ? (
              <span className="board__sr-only"> — exactly {headline.exact}</span>
            ) : null}
            <span className="cost-comp__stack-caption">{headline.caption}</span>
          </p>
          <CostStack composition={composition} categories={categories} />
        </div>
      )}

      <CostLegend composition={composition} categories={categories} />
      <Overshoot composition={composition} />
      <Excluded composition={composition} />
      <Uncounted composition={composition} />
    </section>
  );
}

/** Pick the drawing. Two radios in a segmented control, not a mystery icon. */
function FormToggle({
  form,
  onChange,
}: {
  form: CostChartForm;
  onChange: (next: CostChartForm) => void;
}) {
  return (
    <div className="cost-comp__forms" role="group" aria-label="Chart shape">
      {(["donut", "bar"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={
            "cost-comp__form" +
            (form === option ? " cost-comp__form--on" : "")
          }
          aria-pressed={form === option}
          onClick={() => onChange(option)}
        >
          {option === "donut" ? "Donut" : "Bar"}
        </button>
      ))}
    </div>
  );
}

/**
 * The same model as a stacked bar.
 *
 * Easier to compare than the ring — a length beats an angle — and it reuses the
 * strip's existing bar anatomy exactly: the same track, the same 2px gap
 * between fills, the same red rule where the target ran out. Only the fill
 * changed, from one accent measure to the lanes that make it up.
 */
function CostStack({
  composition,
  categories,
}: {
  composition: Composition;
  categories: readonly CategoryView[];
}) {
  const { slices, targetMark, overspend, target } = composition;
  return (
    <div
      className={"tally-bar" + (target !== null ? " tally-bar--target" : "")}
      aria-hidden="true"
    >
      {slices.map((slice) => (
        <div
          key={slice.categoryId ?? "tail"}
          className={
            "tally-bar__seg tally-bar__seg--cat" +
            (slice.categoryId === null ? " tally-bar__seg--tail" : "")
          }
          style={{
            width: `${slice.share * 100}%`,
            ...categoryHueStyleById(slice.categoryId, categories),
          }}
        />
      ))}
      {targetMark !== null && overspend > 0 ? (
        <span
          className="tally-bar__limit"
          style={{ left: `${targetMark * 100}%` }}
        />
      ) : null}
    </div>
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
}: {
  composition: Composition;
  categories: readonly CategoryView[];
}) {
  const { slices, currency, approximate } = composition;
  const write = (n: number) =>
    approximate ? approx(n, currency) : money(n, currency);

  return (
    <ul className="cost-comp__legend">
      {slices.map((slice) => (
        <li className="cost-comp__row" key={slice.categoryId ?? "tail"}>
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
        </li>
      ))}
    </ul>
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
      <strong>{amount}</strong> over target, per person
      <span className="cost-comp__over-pct">
        {" "}
        · {Math.round(overshare * 100)}% above it
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
 */
function Excluded({ composition }: { composition: Composition }) {
  const { excluded } = composition;
  if (excluded.length === 0) return null;
  return (
    <div className="cost-comp__aside">
      <p className="cost-comp__aside-head">Priced for part of the group</p>
      <ul className="cost-comp__aside-list">
        {excluded.map((e) => (
          <li key={e.optionId}>
            <span className="cost-comp__aside-name">{e.title}</span>{" "}
            <strong>{money(e.perPerson, e.currency)}</strong> per person for{" "}
            {e.headcount} {e.headcount === 1 ? "member" : "members"}
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
      {uncounted.join(", ")} not counted — no rate to convert with
    </p>
  );
}

