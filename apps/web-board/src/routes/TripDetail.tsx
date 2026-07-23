import { Link, useParams } from "react-router-dom";
import { useTrip } from "@gtp/api-client";
import type { TripDetail as TripDetailData } from "@gtp/types";

const ROLE_LABEL: Record<TripDetailData["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

// A board previews the five built-in category lanes; the real, seeded
// categories (and cards) arrive in Phase 2.
const PREVIEW_LANES = [
  "Dates",
  "Transport",
  "Stay",
  "Food",
  "Activities",
] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

/**
 * A single trip board shell (Phase 1.1). Shows the trip identity + a preview of
 * the category lanes; proposing, dot-voting and drag-to-Decided arrive later.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const trip = useTrip(id);

  return (
    <main className="board">
      <header className="board__bar">
        <Link className="board__brand board__brand--link" to="/">
          ‹ Boards
        </Link>
      </header>

      {trip.isPending ? (
        <p className="board__muted">Loading board…</p>
      ) : trip.isError ? (
        <>
          <p className="board__form-error" role="alert">
            {trip.error.status === 404
              ? "That board doesn't exist or you're not a member."
              : "Couldn't load this board."}
          </p>
          <Link className="board__cta" to="/">
            Back to boards
          </Link>
        </>
      ) : (
        <>
          <p className="board__eyebrow">
            {trip.data.status === "HISTORY" ? "History" : "Active"} ·{" "}
            {ROLE_LABEL[trip.data.role]}
          </p>
          <h1 className="board__title">{trip.data.name}</h1>
          <p className="board__muted">
            {trip.data.destination ?? "No destination yet"} ·{" "}
            {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)} ·{" "}
            {trip.data.memberCount} member
            {trip.data.memberCount === 1 ? "" : "s"} ·{" "}
            {trip.data.defaultCurrency}
          </p>

          <div className="board__canvas" aria-label="Category lanes (preview)">
            {PREVIEW_LANES.map((lane) => (
              <section key={lane} className="lane">
                <h2 className="lane__title">{lane}</h2>
                <div className="lane__card lane__card--ghost">
                  Cards arrive in Phase 2
                </div>
              </section>
            ))}
            <section className="lane lane--decided">
              <h2 className="lane__title">✦ Decided</h2>
              <div className="lane__card lane__card--ghost">
                Locked picks land here
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
