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
 * Trip-Board cost surface (Phase 3.3): a **live tally widget pinned on the
 * canvas**. Compact by design — it sits alongside the lanes and shows the shared
 * {@link TripDashboardView} as per-currency committed/projected chips, group and
 * per-person, plus a stale-headcount dot. Functional four states.
 */
export function CostTally({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);

  return (
    <aside className="board__tally" aria-label="Cost tally">
      <h2 className="board__tally-title">Tally</h2>
      {dash.isPending ? (
        <p className="board__tally-muted">Counting…</p>
      ) : dash.isError ? (
        <p className="board__tally-muted" role="alert">
          Couldn't load the tally.
        </p>
      ) : dash.data.committed.length === 0 &&
        dash.data.projected.length === 0 ? (
        <p className="board__tally-muted">
          Price an option to start the tally.
        </p>
      ) : (
        <TallyBody d={dash.data} />
      )}
    </aside>
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
      {d.projected.map((proj) => {
        const committed = d.committed.find((c) => c.currency === proj.currency);
        return (
          <div
            key={proj.currency}
            className="board__tally-cur"
            aria-label={`Cost in ${proj.currency}`}
          >
            <span className="board__tally-code">{proj.currency}</span>
            <div className="board__tally-chip">
              <span className="board__tally-tag">Locked</span>
              <strong>{money(committed?.group ?? 0, proj.currency)}</strong>
              <span className="board__tally-per">
                {money(committed?.perPerson ?? 0, proj.currency)}/pp
              </span>
            </div>
            <div className="board__tally-chip board__tally-chip--proj">
              <span className="board__tally-tag">If front-runners win</span>
              <strong>{money(proj.group, proj.currency)}</strong>
              <span className="board__tally-per">
                {money(proj.perPerson, proj.currency)}/pp
              </span>
            </div>
          </div>
        );
      })}
      <p className="board__tally-foot">
        {d.memberCount} member{d.memberCount === 1 ? "" : "s"} · per currency
      </p>
    </>
  );
}
