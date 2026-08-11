import { useTripDashboard } from "@gtp/api-client";
import type { TripDashboardView } from "@gtp/types";
import { CostBar } from "./CostBar";
// The strip's private formatter moved to `lib/money` when the option cards
// needed the same thing. One definition, so a total and the cards it is the sum
// of cannot disagree about how money is written.
import { formatMoney as money } from "../lib/money";

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

function TallyBody({ d }: { d: TripDashboardView }) {
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
          return (
            <div
              key={proj.currency}
              className="board__tally-cur"
              aria-label={`Cost in ${proj.currency}`}
            >
              <span className="board__tally-code">{proj.currency}</span>
              <CostBar committed={committedGroup} projected={proj.group} />
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
      <p className="board__tally-foot">
        {d.memberCount} member{d.memberCount === 1 ? "" : "s"} · per currency
      </p>
    </>
  );
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
  const proj = d.projected.find((p) => p.currency === d.defaultCurrency);
  const spend = proj?.perPerson ?? 0;
  const over = spend > target;
  const others = d.projected.filter((p) => p.currency !== d.defaultCurrency);

  return (
    <p
      className={"board__budget" + (over ? " board__budget--over" : "")}
      role="status"
    >
      <span className="board__budget-label">Target</span>
      <strong>{money(target, d.defaultCurrency)}</strong>
      <span className="board__budget-per">/person</span>
      <span className="board__budget-verdict">
        {over
          ? `${money(spend - target, d.defaultCurrency)} over`
          : `${money(target - spend, d.defaultCurrency)} to spare`}
        {/* Never silently compare across currencies. */}
        {others.length > 0
          ? ` · ${others.map((p) => p.currency).join(", ")} not counted`
          : ""}
      </span>
    </p>
  );
}
