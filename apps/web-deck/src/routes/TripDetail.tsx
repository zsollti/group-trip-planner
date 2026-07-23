import { Link, useParams } from "react-router-dom";
import { useTrip } from "@gtp/api-client";
import type { TripDetail as TripDetailData } from "@gtp/types";

const ROLE_LABEL: Record<TripDetailData["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

/**
 * Trip console shell (Phase 1.1). Categories, options, and the ledger arrive in
 * later phases; for now it surfaces the trip's identity + the caller's role.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const trip = useTrip(id);

  return (
    <main className="deck">
      <header className="deck__bar">
        <Link className="deck__brand deck__brand--link" to="/">
          ← COMMAND DECK
        </Link>
      </header>

      <section className="deck__body">
        {trip.isPending ? (
          <p className="deck__lede">Loading trip…</p>
        ) : trip.isError ? (
          <div className="deck__empty">
            <p className="deck__form-error" role="alert">
              {trip.error.status === 404
                ? "That trip doesn't exist or you're not a member."
                : "Couldn't load this trip."}
            </p>
            <Link className="deck__cta" to="/">
              Back to deck
            </Link>
          </div>
        ) : (
          <>
            <div className="deck__manifest-head">
              <p className="deck__eyebrow">
                {trip.data.status === "HISTORY" ? "History" : "Active trip"}
              </p>
              <span className="deck__badge">{ROLE_LABEL[trip.data.role]}</span>
            </div>
            <h1 className="deck__title">{trip.data.name}</h1>
            {trip.data.description ? (
              <p className="deck__lede">{trip.data.description}</p>
            ) : null}
            <dl className="deck__facts">
              <div>
                <dt>Destination</dt>
                <dd>{trip.data.destination ?? "—"}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>
                  {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)}
                </dd>
              </div>
              <div>
                <dt>Members</dt>
                <dd>{trip.data.memberCount}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{trip.data.defaultCurrency}</dd>
              </div>
            </dl>
            <p className="deck__muted">
              Planning surfaces (categories, options, voting, the cost ledger)
              land in the next phases.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
