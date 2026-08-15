import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useHomeDashboard } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { CreateBoardDialog } from "../components/CreateBoardDialog";
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
 * What a brand-new user sees instead of a wall of tiles (Phase 6.4).
 *
 * A short explanation of what a board *is* and one obvious next action — no
 * guided tour and no seeded demo trip, both of which leave a new account with
 * something to clean up before it feels like theirs.
 *
 * The verified/unverified split matters: creating a trip is gated on a verified
 * email (FR-7, `VerifiedEmailGuard`), but signing in is not. So an account that
 * has registered and not yet clicked the emailed link lands right here — and
 * before 6.4 it got the full-strength "Create your first trip" CTA, filled in
 * the form, and ate a 403 from the server. An unverified visitor now gets the
 * step that actually unblocks them, plus the honest news that the rest of the
 * app already works for them: joining an invite, proposing, voting and chatting
 * all deliberately skip the verified-email gate.
 */
function Onboarding({
  verified,
  email,
  onCreate,
}: {
  verified: boolean;
  email?: string;
  onCreate: () => void;
}) {
  return (
    <section className="board__onboard" aria-labelledby="onboard-heading">
      <h2 className="board__onboard-title" id="onboard-heading">
        {verified ? "Start your first board" : "One step first"}
      </h2>
      <p className="board__onboard-lead">
        A trip board is one shared canvas per trip: lanes for dates, transport,
        stay, food and whatever else you add. Everyone drops in options, votes
        on them, and an organiser locks in the winners — which stay at the top
        of the lane they answer, with a running cost above.
      </p>

      {verified ? (
        <>
          <button type="button" className="board__cta" onClick={onCreate}>
            Create your first trip
          </button>
          <p className="board__onboard-note">
            You'll be its owner, and you can invite the others with a link.
          </p>
        </>
      ) : (
        <div className="board__onboard-gate">
          <p className="board__onboard-note">
            Creating a board needs a verified email address. We sent a link to{" "}
            <strong>{email ?? "your address"}</strong> — open it and come back.
          </p>
          <p className="board__onboard-note">
            You don't have to wait to take part: you can already join a board
            you've been invited to, propose options, vote and chat.
          </p>
        </div>
      )}
    </section>
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

  const list = dash.data?.trips ?? [];
  const active = list.filter((t) => t.status === "ACTIVE");
  const history = list.filter((t) => t.status === "HISTORY");

  return (
    <main className="board board--measure">
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
          <UserMenu />
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
        <Onboarding
          verified={user?.emailVerified ?? false}
          email={user?.email}
          onCreate={() => setCreateOpen(true)}
        />
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
    </main>
  );
}
