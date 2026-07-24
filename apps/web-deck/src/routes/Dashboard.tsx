import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, useHomeDashboard } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { CommandPalette } from "../components/CommandPalette";
import { CreateTripDialog } from "../components/CreateTripDialog";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";

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

/** One Active/History manifest section of trip rows (Phase 3.4). */
function TripManifest({
  title,
  trips,
}: {
  title: string;
  trips: HomeTripSummary[];
}) {
  if (trips.length === 0) return null;
  return (
    <section className="deck__manifest-section" aria-label={`${title} trips`}>
      <p className="deck__eyebrow deck__manifest-title">{title}</p>
      <ul className="deck__manifest">
        {trips.map((trip) => (
          <li key={trip.id}>
            <Link className="deck__row deck__row--rich" to={`/trips/${trip.id}`}>
              <span className="deck__row-name">{trip.name}</span>
              <span className="deck__row-meta">{trip.destination ?? "—"}</span>
              <span className="deck__row-meta">
                {trip.memberCount} member{trip.memberCount === 1 ? "" : "s"}
              </span>
              <span className="deck__row-cost">{costLabel(trip.cost)}</span>
              {trip.pendingDecisionCount > 0 ? (
                <span className="deck__row-pending">
                  {trip.pendingDecisionCount} pending
                </span>
              ) : (
                <span className="deck__row-meta">All decided</span>
              )}
              <span className="deck__badge">{ROLE_LABEL[trip.role]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The authenticated workspace. Expresses the Deck paradigm: a console shell
 * driven by the ⌘K command palette, now listing the caller's trips as a
 * console manifest (Phase 1.1).
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const dash = useHomeDashboard();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const list = dash.data?.trips ?? [];
  const active = list.filter((t) => t.status === "ACTIVE");
  const history = list.filter((t) => t.status === "HISTORY");

  return (
    <main className="deck">
      <header className="deck__bar">
        <span className="deck__brand">GTP · COMMAND DECK</span>
        <button
          type="button"
          className="deck__kbd"
          onClick={() => setPaletteOpen(true)}
        >
          ⌘K
        </button>
      </header>

      <section className="deck__body">
        <p className="deck__eyebrow">Workspace</p>
        <h1 className="deck__title">Welcome, {user?.displayName}</h1>

        {dash.isPending ? (
          <p className="deck__lede">Loading trips…</p>
        ) : dash.isError ? (
          <p className="deck__form-error" role="alert">
            Couldn't load your trips.{" "}
            <button
              type="button"
              className="deck__link-btn"
              onClick={() => void dash.refetch()}
            >
              Retry
            </button>
          </p>
        ) : list.length === 0 ? (
          <div className="deck__empty">
            <p className="deck__lede">
              No trips yet. This is your command deck — spin up your first one.
            </p>
            <button
              type="button"
              className="deck__cta"
              onClick={() => setCreateOpen(true)}
            >
              Create your first trip
            </button>
          </div>
        ) : (
          <>
            <div className="deck__manifest-head">
              <span className="deck__eyebrow">
                {list.length} trip{list.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="deck__cta deck__cta--sm"
                onClick={() => setCreateOpen(true)}
              >
                ＋ New trip
              </button>
            </div>
            <TripManifest title="Active" trips={active} />
            <TripManifest title="History" trips={history} />
          </>
        )}
      </section>

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={[
            { label: "New trip", run: () => setCreateOpen(true) },
            {
              label: "Delete account",
              run: () => setDeleteAccountOpen(true),
            },
            { label: "Log out", run: () => void logout() },
          ]}
        />
      ) : null}
      {createOpen ? (
        <CreateTripDialog onClose={() => setCreateOpen(false)} />
      ) : null}
      {deleteAccountOpen ? (
        <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
      ) : null}
    </main>
  );
}
