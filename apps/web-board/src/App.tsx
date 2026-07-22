import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION, useLogin } from "@gtp/api-client";

const LANES = ["Dates", "Transport", "Stay", "✦ Decided"] as const;

/**
 * UI C — Trip Board (placeholder shell).
 * Full drag-and-drop canvas + auth land in Phase 0.7. The top-bar button is a
 * Phase-0 wiring check over the shared, typed login hook.
 */
export function App() {
  const login = useLogin();

  return (
    <main className="board">
      <header className="board__bar">
        <span className="board__brand">GTP · Trip Board</span>
        <Button
          variant="secondary"
          className="board__invite"
          disabled={login.isPending}
          onClick={() =>
            login.mutate({
              email: "demo@example.com",
              password: "demo-password",
            })
          }
        >
          {login.isPending ? "Pinging…" : "Ping /auth/login"}
        </Button>
      </header>
      <p className="board__eyebrow">Phase 0 · walking skeleton</p>
      <h1 className="board__title">Spatial drag-and-drop planning canvas</h1>
      <div className="board__canvas">
        {LANES.map((lane) => (
          <section key={lane} className="lane">
            <h2 className="lane__title">{lane}</h2>
            <div className="lane__card lane__card--ghost">
              Cards arrive in Phase 0.7
            </div>
          </section>
        ))}
      </div>
      <p className="board__meta">
        shared contract v{API_CLIENT_VERSION} · login: {login.status}
      </p>
    </main>
  );
}
