import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useMyTrips } from "@gtp/api-client";
import type { TripSummary } from "@gtp/types";
import { CreateBoardDialog } from "../components/CreateBoardDialog";

const ROLE_LABEL: Record<TripSummary["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-org",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

/**
 * The authenticated boards overview. Expresses the Board paradigm: a spatial
 * canvas — now a wall of trip-board tiles the caller can open (Phase 1.1).
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const trips = useMyTrips();
  const [createOpen, setCreateOpen] = useState(false);

  const list = trips.data ?? [];

  return (
    <main className="board">
      <header className="board__bar">
        <span className="board__brand">GTP · Trip Board</span>
        <div className="board__bar-actions">
          <Button
            type="button"
            variant="primary"
            onClick={() => setCreateOpen(true)}
          >
            ＋ New board
          </Button>
          <Button type="button" variant="secondary" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </header>

      <p className="board__eyebrow">Boards</p>
      <h1 className="board__title">Welcome, {user?.displayName}</h1>

      {trips.isPending ? (
        <p className="board__muted">Loading your boards…</p>
      ) : trips.isError ? (
        <p className="board__form-error" role="alert">
          Couldn't load your boards.{" "}
          <button
            type="button"
            className="board__link-btn"
            onClick={() => void trips.refetch()}
          >
            Retry
          </button>
        </p>
      ) : list.length === 0 ? (
        <>
          <p className="board__muted">
            No boards yet. Create your first one to start planning on the
            canvas.
          </p>
          <button
            type="button"
            className="board__cta"
            onClick={() => setCreateOpen(true)}
          >
            Create your first trip
          </button>
        </>
      ) : (
        <div className="board__tiles" aria-label="Your trip boards">
          {list.map((trip) => (
            <Link
              key={trip.id}
              className="board__tile"
              to={`/trips/${trip.id}`}
            >
              <span className="board__tile-badge">{ROLE_LABEL[trip.role]}</span>
              <span className="board__tile-name">{trip.name}</span>
              <span className="board__tile-meta">
                {trip.destination ?? "No destination yet"}
              </span>
              <span className="board__tile-meta">
                {trip.memberCount} member{trip.memberCount === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateBoardDialog onClose={() => setCreateOpen(false)} />
      ) : null}
    </main>
  );
}
