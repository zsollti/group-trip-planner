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
 * Trip screen shell (Phase 1.1). Planning surfaces arrive in later phases; for
 * now it shows the trip's identity + the caller's role.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const trip = useTrip(id);

  return (
    <div className="feed">
      <header className="feed__topbar">
        <Link className="feed__back" to="/" aria-label="Back to home">
          ‹ Home
        </Link>
      </header>
      <main className="feed__screen">
        {trip.isPending ? (
          <p className="feed__muted">Loading trip…</p>
        ) : trip.isError ? (
          <div className="feed__card">
            <div className="feed__card-media">🚫</div>
            <p className="feed__card-body">
              {trip.error.status === 404
                ? "That trip doesn't exist or you're not a member."
                : "Couldn't load this trip."}
            </p>
            <div className="feed__card-cta">
              <Link className="feed__alt" to="/">
                Back to home
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="feed__eyebrow">
              {trip.data.status === "HISTORY" ? "History" : "Active trip"} ·{" "}
              {ROLE_LABEL[trip.data.role]}
            </p>
            <h1 className="feed__title">{trip.data.name}</h1>
            {trip.data.description ? (
              <p className="feed__muted">{trip.data.description}</p>
            ) : null}
            <div className="feed__card">
              <dl className="feed__facts">
                <div>
                  <dt>Destination</dt>
                  <dd>{trip.data.destination ?? "—"}</dd>
                </div>
                <div>
                  <dt>Dates</dt>
                  <dd>
                    {fmtDate(trip.data.startDate)} –{" "}
                    {fmtDate(trip.data.endDate)}
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
            </div>
            <p className="feed__muted">
              Categories, options, voting and the cost view land in the next
              phases.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
