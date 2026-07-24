import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useHomeDashboard } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { CreateTripSheet } from "../components/CreateTripSheet";
import { DeleteAccountSheet } from "../components/DeleteAccountSheet";

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
  if (cost.length === 0) return "No committed cost yet";
  return cost.map((c) => money(c.committed, c.currency)).join(" · ");
}

type Tab = "home" | "plan" | "cost" | "profile";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "plan", icon: "🗳️", label: "Plan" },
  { id: "cost", icon: "💶", label: "Cost" },
  { id: "profile", icon: "👤", label: "Profile" },
];

const ROLE_LABEL: Record<HomeTripSummary["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-org",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

/** One trip card in the home feed (Phase 3.4) — with cost + pending line. */
function TripCard({ trip }: { trip: HomeTripSummary }) {
  return (
    <li>
      <Link className="feed__trip-card" to={`/trips/${trip.id}`}>
        <div className="feed__trip-media" aria-hidden="true">
          🧭
        </div>
        <div className="feed__trip-body">
          <span className="feed__trip-name">{trip.name}</span>
          <span className="feed__trip-meta">
            {trip.destination ?? "No destination yet"} · {trip.memberCount}{" "}
            member{trip.memberCount === 1 ? "" : "s"}
          </span>
          <span className="feed__trip-cost">
            {costLabel(trip.cost)}
            {trip.pendingDecisionCount > 0 ? (
              <span className="feed__trip-pending">
                {trip.pendingDecisionCount} pending
              </span>
            ) : null}
          </span>
        </div>
        <span className="feed__trip-badge">{ROLE_LABEL[trip.role]}</span>
      </Link>
    </li>
  );
}

/**
 * The authenticated home. Expresses the Feed paradigm: a phone-width column
 * with a bottom tab bar and a FAB. The Home tab is now a feed of trip cards
 * (Phase 1.1).
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const dash = useHomeDashboard();
  const [tab, setTab] = useState<Tab>("home");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const list = dash.data?.trips ?? [];
  const active = list.filter((t) => t.status === "ACTIVE");
  const history = list.filter((t) => t.status === "HISTORY");

  return (
    <div className="feed">
      <main className="feed__screen">
        {tab === "profile" ? (
          <>
            <p className="feed__eyebrow">Profile</p>
            <h1 className="feed__title">{user?.displayName}</h1>
            <p className="feed__muted">{user?.email}</p>
            <Button type="button" variant="secondary" onClick={() => logout()}>
              Log out
            </Button>
            <p className="feed__eyebrow feed__danger-heading">Danger zone</p>
            <button
              type="button"
              className="feed__link-btn feed__danger-link"
              onClick={() => setDeleteAccountOpen(true)}
            >
              Delete account
            </button>
          </>
        ) : tab === "home" ? (
          <>
            <p className="feed__eyebrow">Home</p>
            <h1 className="feed__title">Hi, {user?.displayName}</h1>

            {dash.isPending ? (
              <p className="feed__muted">Loading your trips…</p>
            ) : dash.isError ? (
              <div className="feed__card">
                <p className="feed__card-body">
                  Couldn't load your trips.{" "}
                  <button
                    type="button"
                    className="feed__link-btn"
                    onClick={() => void dash.refetch()}
                  >
                    Retry
                  </button>
                </p>
              </div>
            ) : list.length === 0 ? (
              <div className="feed__card">
                <div className="feed__card-media">🧭</div>
                <p className="feed__card-body">
                  No trips yet. Tap ＋ to start planning your first one.
                </p>
                <div className="feed__card-cta">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setCreateOpen(true)}
                  >
                    Create your first trip
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {active.length > 0 ? (
                  <ul className="feed__trips">
                    {active.map((trip) => (
                      <TripCard key={trip.id} trip={trip} />
                    ))}
                  </ul>
                ) : null}
                {history.length > 0 ? (
                  <>
                    <p className="feed__eyebrow feed__history-head">History</p>
                    <ul className="feed__trips">
                      {history.map((trip) => (
                        <TripCard key={trip.id} trip={trip} />
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <p className="feed__eyebrow">
              {TABS.find((t) => t.id === tab)?.label}
            </p>
            <h1 className="feed__title">Coming soon</h1>
            <p className="feed__muted">
              Open a trip from Home to start planning.
            </p>
          </>
        )}
      </main>

      <button
        type="button"
        className="feed__fab"
        aria-label="New trip"
        onClick={() => setCreateOpen(true)}
      >
        ＋
      </button>

      <nav className="feed__tabs" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="feed__tab"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="feed__tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="feed__tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {createOpen ? (
        <CreateTripSheet onClose={() => setCreateOpen(false)} />
      ) : null}
      {deleteAccountOpen ? (
        <DeleteAccountSheet onClose={() => setDeleteAccountOpen(false)} />
      ) : null}
    </div>
  );
}
