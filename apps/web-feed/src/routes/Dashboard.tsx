import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { useAuth, useMyTrips } from "@gtp/api-client";
import type { TripSummary } from "@gtp/types";
import { CreateTripSheet } from "../components/CreateTripSheet";

type Tab = "home" | "plan" | "cost" | "profile";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "plan", icon: "🗳️", label: "Plan" },
  { id: "cost", icon: "💶", label: "Cost" },
  { id: "profile", icon: "👤", label: "Profile" },
];

const ROLE_LABEL: Record<TripSummary["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-org",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

/**
 * The authenticated home. Expresses the Feed paradigm: a phone-width column
 * with a bottom tab bar and a FAB. The Home tab is now a feed of trip cards
 * (Phase 1.1).
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const trips = useMyTrips();
  const [tab, setTab] = useState<Tab>("home");
  const [createOpen, setCreateOpen] = useState(false);

  const list = trips.data ?? [];

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
          </>
        ) : tab === "home" ? (
          <>
            <p className="feed__eyebrow">Home</p>
            <h1 className="feed__title">Hi, {user?.displayName}</h1>

            {trips.isPending ? (
              <p className="feed__muted">Loading your trips…</p>
            ) : trips.isError ? (
              <div className="feed__card">
                <p className="feed__card-body">
                  Couldn't load your trips.{" "}
                  <button
                    type="button"
                    className="feed__link-btn"
                    onClick={() => void trips.refetch()}
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
              <ul className="feed__trips">
                {list.map((trip) => (
                  <li key={trip.id}>
                    <Link className="feed__trip-card" to={`/trips/${trip.id}`}>
                      <div className="feed__trip-media" aria-hidden="true">
                        🧭
                      </div>
                      <div className="feed__trip-body">
                        <span className="feed__trip-name">{trip.name}</span>
                        <span className="feed__trip-meta">
                          {trip.destination ?? "No destination yet"} ·{" "}
                          {trip.memberCount} member
                          {trip.memberCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <span className="feed__trip-badge">
                        {ROLE_LABEL[trip.role]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
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
    </div>
  );
}
