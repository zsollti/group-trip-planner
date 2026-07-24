import { useTripDashboard } from "@gtp/api-client";
import type { TripDashboardView } from "@gtp/types";

/** Format a raw amount as its currency, tolerating unknown codes (FR-27). */
function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * Trip-Feed cost surface (Phase 3.3): the **"💶 Cost" tab's summary card**. The
 * feed reveals it via the Plan/Cost tab switch; here it renders the shared
 * {@link TripDashboardView} as a per-currency card — committed vs. projected,
 * group and per-person, with a stale-headcount notice. Functional four states.
 */
export function CostTab({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);

  if (dash.isPending) {
    return <p className="feed__muted">Adding up the costs…</p>;
  }
  if (dash.isError) {
    return (
      <div className="feed__card">
        <div className="feed__card-media">💸</div>
        <p className="feed__card-body" role="alert">
          Couldn't load the cost view.
        </p>
      </div>
    );
  }
  const d = dash.data;
  if (d.committed.length === 0 && d.projected.length === 0) {
    return (
      <div className="feed__card">
        <div className="feed__card-media">💶</div>
        <p className="feed__card-body">
          No priced options yet. Add an amount to an option and the running cost
          shows up here.
        </p>
      </div>
    );
  }
  return <CostCard d={d} />;
}

function CostCard({ d }: { d: TripDashboardView }) {
  return (
    <div className="feed__card feed__cost">
      <p className="feed__eyebrow">💶 Cost</p>
      <p className="feed__muted">
        Across {d.memberCount} traveller{d.memberCount === 1 ? "" : "s"} · totals
        stay per currency (no conversion)
      </p>
      {d.hasStaleHeadcount ? (
        <p className="feed__cost-stale" role="status">
          ⚠ A fixed headcount is out of date since the group changed — re-confirm
          it to refresh the total.
        </p>
      ) : null}
      {d.projected.map((proj) => {
        const committed = d.committed.find((c) => c.currency === proj.currency);
        return (
          <section
            key={proj.currency}
            className="feed__cost-cur"
            aria-label={`Cost in ${proj.currency}`}
          >
            <h3 className="feed__cost-code">{proj.currency}</h3>
            <div className="feed__cost-cols">
              <div className="feed__cost-col">
                <span className="feed__cost-tag">Committed</span>
                <strong className="feed__cost-amount">
                  {money(committed?.group ?? 0, proj.currency)}
                </strong>
                <span className="feed__muted">
                  {money(committed?.perPerson ?? 0, proj.currency)} / person
                </span>
              </div>
              <div className="feed__cost-col feed__cost-col--proj">
                <span className="feed__cost-tag">Projected</span>
                <strong className="feed__cost-amount">
                  {money(proj.group, proj.currency)}
                </strong>
                <span className="feed__muted">
                  {money(proj.perPerson, proj.currency)} / person
                </span>
              </div>
            </div>
          </section>
        );
      })}
      <p className="feed__muted feed__cost-legend">
        <strong>Committed</strong> counts locked decisions.{" "}
        <strong>Projected</strong> adds each open category's front-runner.
      </p>
    </div>
  );
}
