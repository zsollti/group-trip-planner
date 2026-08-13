import { useTripDashboard } from "@gtp/api-client";
import type { TripDashboardView } from "@gtp/types";
import { CostBar } from "./CostBar";
// The strip's private formatter moved to `lib/money` when the option cards
// needed the same thing. One definition, so a total and the cards it is the sum
// of cannot disagree about how money is written.
import {
  formatApproxMoney as approx,
  formatMoney as money,
} from "../lib/money";

/** A one-line collapsed peek: the first currency's locked → projected total. */
function peek(d: TripDashboardView): string {
  const proj = d.projected[0];
  if (!proj) return "No cost yet";
  const committed = d.committed.find((c) => c.currency === proj.currency);
  const more = d.projected.length > 1 ? " +" : "";
  return `${money(committed?.group ?? 0, proj.currency)} → ${money(
    proj.group,
    proj.currency,
  )}${more}`;
}

/**
 * Trip-Board cost surface (Phase 3.5) — a **full-width collapsible strip** under
 * the trip header (moved out of the horizontal lane scroll, which made mobile
 * unusable; option A). Collapsed it shows a one-line peek; expanded it lays the
 * per-currency committed-vs-projected bars out in a row, group + per-person, with
 * the stale-headcount warning. Native `<details>` gives free keyboard + a11y.
 * Functional four states.
 */
export function CostTally({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);

  return (
    <details className="board__cost-strip" open>
      <summary className="board__cost-summary">
        <span className="board__cost-label">💶 Cost</span>
        {dash.data &&
        (dash.data.committed.length > 0 || dash.data.projected.length > 0) ? (
          <span className="board__cost-peek">{peek(dash.data)}</span>
        ) : null}
      </summary>
      <div className="board__cost-body">
        {dash.isPending ? (
          <p className="board__tally-muted">Counting…</p>
        ) : dash.isError ? (
          <p className="board__tally-muted" role="alert">
            Couldn't load the cost.
          </p>
        ) : dash.data.committed.length === 0 &&
          dash.data.projected.length === 0 ? (
          <p className="board__tally-muted">
            Price an option to start the tally.
          </p>
        ) : (
          <TallyBody d={dash.data} />
        )}
        {/* Outside the branch above on purpose: the tally only draws once
            something is priced, and a target that showed nothing until then
            would read as an edit that failed to save. */}
        {dash.data ? <BudgetLine d={dash.data} /> : null}
      </div>
    </details>
  );
}

/**
 * The approximate all-in total, when it says something the exact figures don't.
 *
 * Null for a trip priced entirely in its own currency: the conversion would
 * restate a number already on screen. It is also the switch that decides **who
 * speaks for the target** — see `BudgetLine`.
 */
function allInTotal(d: TripDashboardView): TripDashboardView["converted"] {
  const c = d.converted;
  if (!c) return null;
  return d.projected.some((p) => p.currency !== c.currency) ? c : null;
}

function TallyBody({ d }: { d: TripDashboardView }) {
  // One target, one place. Once there is an all-in figure, the target belongs
  // to *it* — scaling a single currency's bar against a budget that now spans
  // several would say "you have used a third of your budget on hotels" while
  // quietly leaving the forints out of the picture.
  const perCurrencyTarget = allInTotal(d) === null ? d.budgetPerPerson : null;
  return (
    <>
      {d.hasStaleHeadcount ? (
        <p className="board__tally-stale" role="status">
          ⚠ Fixed headcount out of date
        </p>
      ) : null}
      <div className="board__tally-legend" aria-hidden="true">
        <span className="board__tally-key">
          <i className="board__swatch board__swatch--committed" />
          Locked
        </span>
        <span className="board__tally-key">
          <i className="board__swatch board__swatch--extra" />
          If front-runners win
        </span>
      </div>
      <div className="board__cost-currencies">
        {d.projected.map((proj) => {
          const committed = d.committed.find(
            (c) => c.currency === proj.currency,
          );
          const committedGroup = committed?.group ?? 0;
          // A target can only speak to the trip's own currency, because totals
          // are never converted (FR-27) — the other bars keep scaling to
          // themselves, and `BudgetLine` names them as not counted.
          const target =
            proj.currency === d.defaultCurrency ? perCurrencyTarget : null;
          // Drawn in the unit the target is in whenever there is one. The two
          // are not interchangeable: an option with a fixed headcount is
          // divided by that headcount and not by the trip's, so the per-person
          // figures are not the group ones over `memberCount`. Scaling group
          // money against a per-person target would put the mark somewhere the
          // "€X over" sentence below disagrees with.
          const [barCommitted, barProjected] =
            target === null
              ? [committedGroup, proj.group]
              : [committed?.perPerson ?? 0, proj.perPerson];
          return (
            <div
              key={proj.currency}
              className="board__tally-cur"
              aria-label={`Cost in ${proj.currency}`}
            >
              <span className="board__tally-code">{proj.currency}</span>
              <CostBar
                committed={barCommitted}
                projected={barProjected}
                target={target}
              />
              <div className="board__tally-figs">
                <span className="board__tally-fig">
                  <strong>{money(committedGroup, proj.currency)}</strong>
                  <span className="board__tally-per">
                    {money(committed?.perPerson ?? 0, proj.currency)}/pp locked
                  </span>
                </span>
                <span className="board__tally-fig board__tally-fig--proj">
                  <strong>{money(proj.group, proj.currency)}</strong>
                  <span className="board__tally-per">
                    {money(proj.perPerson, proj.currency)}/pp projected
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <ApproxTotal d={d} />
      <p className="board__tally-foot">
        {d.memberCount} member{d.memberCount === 1 ? "" : "s"} · per currency
      </p>
    </>
  );
}

/**
 * The same money, roughly, in one currency (post-launch).
 *
 * The per-currency figures above are exact and stay the point; this answers the
 * question they cannot — "so what does the whole thing come to?" — and is
 * marked as an approximation everywhere it appears: the `≈`, whole units with
 * no cents, and the date of the rates it used. A reader who wants a real number
 * has three of them a line above.
 *
 * **Shown only when it says something new.** A trip priced entirely in its own
 * currency would get an approximation of a figure already on screen, exactly
 * equal to it, which is noise at best and faintly insulting at worst.
 */
function ApproxTotal({ d }: { d: TripDashboardView }) {
  const c = allInTotal(d);
  if (!c) return null;

  return (
    <p className="board__approx">
      <strong>{approx(c.projected.group, c.currency)}</strong>
      <span className="board__approx-per">
        {approx(c.projected.perPerson, c.currency)}/person
      </span>
      <span className="board__approx-note">
        rates of {rateDay(c.asOf)}
        {c.missing.length > 0 ? ` · ${c.missing.join(", ")} not converted` : ""}
      </span>
    </p>
  );
}

/**
 * The rates' publication date, in the reader's locale.
 *
 * `asOf` is a **calendar day**, not an instant — the same class of value as a
 * trip's start date, and it has the same trap: read with local getters, "12
 * August" is 11 August across the Americas. Formatted in UTC, which is the zone
 * the day was named in.
 */
function rateDay(asOf: string): string {
  return new Date(`${asOf}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The per-person target, and how the projection is doing against it.
 *
 * The whole point of the retired Budget category, put where it belongs: beside
 * the total it is meant to bound rather than in a lane pretending to be a
 * decision. It compares against the **projection**, not the locked total —
 * "what will this cost us if the front-runners win" is the question a target
 * answers, and comparing against what is already locked would only ever say
 * "fine" until the trip was fully decided.
 *
 * It speaks to the trip's own currency alone. Totals are never converted
 * (FR-27), so a trip pricing things in three currencies has three per-person
 * figures; the line says which one it is reading rather than implying the
 * others are covered.
 */
function BudgetLine({ d }: { d: TripDashboardView }) {
  if (d.budgetPerPerson === null) return null;

  const target = d.budgetPerPerson;
  const allIn = allInTotal(d);

  // With an all-in figure the target finally means what a reader always took it
  // to mean: the whole trip, not the part of it that happened to be priced in
  // the trip's own currency. The verdict then inherits the approximation and
  // says so — an "≈" on a judgement is worth more than on a number, because
  // this is the line someone acts on.
  const spend = allIn
    ? allIn.projected.perPerson
    : (d.projected.find((p) => p.currency === d.defaultCurrency)?.perPerson ??
      0);
  const over = spend > target;
  const gap = over ? spend - target : target - spend;
  const verdict = `${
    allIn ? approx(gap, d.defaultCurrency) : money(gap, d.defaultCurrency)
  } ${over ? "over" : "to spare"}`;

  // What this verdict does not cover — but only when nothing else is saying it.
  // With an all-in figure the line above already names what had no rate, and
  // printing the same sentence twice, one line apart, reads as two different
  // problems.
  const uncounted = allIn
    ? []
    : d.projected
        .filter((p) => p.currency !== d.defaultCurrency)
        .map((p) => p.currency);

  return (
    <p
      className={"board__budget" + (over ? " board__budget--over" : "")}
      role="status"
    >
      <span className="board__budget-label">Target</span>
      <strong>{money(target, d.defaultCurrency)}</strong>
      <span className="board__budget-per">/person</span>
      <span className="board__budget-verdict">
        {verdict}
        {/* Never silently compare across currencies. */}
        {uncounted.length > 0 ? ` · ${uncounted.join(", ")} not counted` : ""}
      </span>
    </p>
  );
}
