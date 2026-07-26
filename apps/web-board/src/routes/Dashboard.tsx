import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useHomeDashboard } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { CreateBoardDialog } from "../components/CreateBoardDialog";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { NotificationBell } from "../components/NotificationBell";
import { UserMenu } from "../components/UserMenu";

const ROLE_LABEL: Record<HomeTripSummary["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-org",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

/** Format a raw amount as its currency, tolerating unknown codes (FR-27). */
function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

/** A trip's committed cost as a compact per-currency string. */
function costLabel(cost: HomeTripSummary["cost"]): string {
  if (cost.length === 0) return "No committed cost";
  return cost.map((c) => money(c.committed, c.currency)).join(" · ");
}

/** One trip-board tile in the overview (Phase 3.4) — with cost + pending. */
function BoardTile({ trip }: { trip: HomeTripSummary }) {
  return (
    <Link className="board__tile" to={`/trips/${trip.id}`}>
      <span className="board__tile-badge">{ROLE_LABEL[trip.role]}</span>
      <span className="board__tile-name">{trip.name}</span>
      <span className="board__tile-meta">
        {trip.destination ?? "No destination yet"}
      </span>
      <span className="board__tile-meta">
        {trip.memberCount} member{trip.memberCount === 1 ? "" : "s"}
      </span>
      <span className="board__tile-cost">{costLabel(trip.cost)}</span>
      {trip.pendingDecisionCount > 0 ? (
        <span className="board__tile-pending">
          {trip.pendingDecisionCount} decision
          {trip.pendingDecisionCount === 1 ? "" : "s"} pending
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The authenticated boards overview. Expresses the Board paradigm: a spatial
 * canvas — now a wall of trip-board tiles the caller can open (Phase 1.1).
 */
export function Dashboard() {
  const { user } = useAuth();
  const dash = useHomeDashboard();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const list = dash.data?.trips ?? [];
  const active = list.filter((t) => t.status === "ACTIVE");
  const history = list.filter((t) => t.status === "HISTORY");

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
          {/* No trip socket on the overview: the bell loads from the server and
              refreshes on focus (live pushes need an open trip screen). */}
          <NotificationBell />
          <UserMenu onDeleteAccount={() => setDeleteAccountOpen(true)} />
        </div>
      </header>

      <p className="board__eyebrow">Boards</p>
      <h1 className="board__title">Welcome, {user?.displayName}</h1>

      {dash.isPending ? (
        <div
          className="board__tiles"
          aria-busy="true"
          aria-label="Loading your boards"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="board__skel-tile" />
          ))}
        </div>
      ) : dash.isError ? (
        <p className="board__form-error" role="alert">
          Couldn't load your boards.{" "}
          <button
            type="button"
            className="board__link-btn"
            onClick={() => void dash.refetch()}
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
        <>
          <div className="board__tiles" aria-label="Your trip boards">
            {active.map((trip) => (
              <BoardTile key={trip.id} trip={trip} />
            ))}
          </div>
          {history.length > 0 ? (
            <>
              <p className="board__eyebrow board__history-head">History</p>
              <div className="board__tiles" aria-label="Ended trip boards">
                {history.map((trip) => (
                  <BoardTile key={trip.id} trip={trip} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      {createOpen ? (
        <CreateBoardDialog onClose={() => setCreateOpen(false)} />
      ) : null}
      {deleteAccountOpen ? (
        <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
      ) : null}
    </main>
  );
}
