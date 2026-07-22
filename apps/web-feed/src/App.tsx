import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION, useLogin } from "@gtp/api-client";

/**
 * UI B — Trip Feed (placeholder shell).
 * Full bottom-tab social app + auth wizard land in Phase 0.7. The button below
 * is a Phase-0 wiring check over the shared, typed login hook.
 */
export function App() {
  const login = useLogin();

  return (
    <div className="feed">
      <main className="feed__screen">
        <p className="feed__eyebrow">Phase 0 · walking skeleton</p>
        <h1 className="feed__title">Mobile-first, thumb-driven trips</h1>
        <div className="feed__card">
          <div className="feed__card-media">🏝️</div>
          <p className="feed__card-body">
            A friendly card feed. Register → verify → login → empty home arrives
            in Phase 0.7.
          </p>
        </div>
        <Button
          variant="primary"
          className="feed__cta"
          disabled={login.isPending}
          onClick={() =>
            login.mutate({
              email: "demo@example.com",
              password: "demo-password",
            })
          }
        >
          {login.isPending ? "Pinging…" : "Ping /auth/login (wiring check)"}
        </Button>
        <p className="feed__meta">
          shared contract v{API_CLIENT_VERSION} · login: {login.status}
        </p>
      </main>
      <nav className="feed__tabs" aria-label="Placeholder navigation">
        <span aria-current="page">🏠</span>
        <span>🗳️</span>
        <span>💶</span>
        <span>👤</span>
      </nav>
    </div>
  );
}
