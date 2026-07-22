import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { useAuth } from "@gtp/api-client";

type Tab = "home" | "plan" | "cost" | "profile";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "plan", icon: "🗳️", label: "Plan" },
  { id: "cost", icon: "💶", label: "Cost" },
  { id: "profile", icon: "👤", label: "Profile" },
];

/**
 * The authenticated home (empty for Phase 0.7). Expresses the Feed paradigm: a
 * full-screen view with a bottom tab bar and a FAB for the primary action.
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("home");

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
        ) : (
          <>
            <p className="feed__eyebrow">
              {TABS.find((t) => t.id === tab)?.label}
            </p>
            <h1 className="feed__title">Hi, {user?.displayName}</h1>
            <div className="feed__card">
              <div className="feed__card-media">🧭</div>
              <p className="feed__card-body">
                No trips yet. Tap ＋ to start planning your first one.
              </p>
            </div>
          </>
        )}
      </main>

      <button type="button" className="feed__fab" aria-label="New trip">
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
    </div>
  );
}
