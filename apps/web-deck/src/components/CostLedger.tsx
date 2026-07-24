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
 * Command-Deck cost surface (Phase 3.3): a **persistent right-rail ledger**. It
 * renders the shared {@link TripDashboardView} (computed server-side by the pure
 * cost engine) as committed-vs-projected per-currency rows, group and per-person,
 * with a stale-headcount warning. Functional four states; flagship polish is the
 * winner's post-gate step (3.5).
 */
export function CostLedger({ tripId }: { tripId: string }) {
  const dash = useTripDashboard(tripId);

  return (
    <aside className="deck__ledger" aria-label="Cost ledger">
      <p className="deck__eyebrow">Cost ledger</p>
      {dash.isPending ? (
        <p className="deck__muted">Tallying the numbers…</p>
      ) : dash.isError ? (
        <p className="deck__muted" role="alert">
          Couldn't load the ledger.
        </p>
      ) : dash.data.committed.length === 0 &&
        dash.data.projected.length === 0 ? (
        <p className="deck__muted">
          No priced options yet. Add an amount to an option to see the running
          cost.
        </p>
      ) : (
        <LedgerBody d={dash.data} />
      )}
    </aside>
  );
}

function LedgerBody({ d }: { d: TripDashboardView }) {
  return (
    <>
      <p className="deck__ledger-note">
        Across {d.memberCount} traveller{d.memberCount === 1 ? "" : "s"} · no
        currency conversion
      </p>
      {d.hasStaleHeadcount ? (
        <p className="deck__ledger-stale" role="status">
          ⚠ A fixed headcount is out of date since the group changed — re-confirm
          it to refresh the total.
        </p>
      ) : null}
      <div className="deck__ledger-currencies">
        {d.projected.map((proj) => {
          const committed = d.committed.find(
            (c) => c.currency === proj.currency,
          );
          return (
            <section
              key={proj.currency}
              className="deck__ledger-cur"
              aria-label={`Cost in ${proj.currency}`}
            >
              <h3 className="deck__ledger-cur-code">{proj.currency}</h3>
              <dl className="deck__ledger-grid">
                <div className="deck__ledger-line">
                  <dt>Committed</dt>
                  <dd>{money(committed?.group ?? 0, proj.currency)}</dd>
                </div>
                <div className="deck__ledger-line deck__ledger-line--sub">
                  <dt>per person</dt>
                  <dd>{money(committed?.perPerson ?? 0, proj.currency)}</dd>
                </div>
                <div className="deck__ledger-line deck__ledger-line--proj">
                  <dt>Projected</dt>
                  <dd>{money(proj.group, proj.currency)}</dd>
                </div>
                <div className="deck__ledger-line deck__ledger-line--sub">
                  <dt>per person</dt>
                  <dd>{money(proj.perPerson, proj.currency)}</dd>
                </div>
              </dl>
            </section>
          );
        })}
      </div>
      <p className="deck__ledger-legend">
        <strong>Committed</strong> = locked decisions ·{" "}
        <strong>Projected</strong> = committed + the current front-runners
      </p>
    </>
  );
}
