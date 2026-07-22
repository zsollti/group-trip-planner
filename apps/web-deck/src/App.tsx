import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION, useLogin } from "@gtp/api-client";

/**
 * UI A — Command Deck (placeholder shell).
 * Full command-palette workspace + auth land in Phase 0.7. The button below is
 * a Phase-0 wiring check: it exercises the shared, typed login hook end to end
 * (the endpoint itself arrives in 0.6).
 */
export function App() {
  const login = useLogin();

  return (
    <main className="deck">
      <header className="deck__bar">
        <span className="deck__brand">GTP · COMMAND DECK</span>
        <kbd className="deck__kbd">⌘K</kbd>
      </header>
      <section className="deck__body">
        <p className="deck__eyebrow">Phase 0 · walking skeleton</p>
        <h1 className="deck__title">Desktop keyboard-first power tool</h1>
        <p className="deck__lede">
          Register → verify → login → empty dashboard arrives in Phase 0.7. This
          placeholder proves the app boots and the shared contract resolves.
        </p>
        <Button
          variant="primary"
          className="deck__cta"
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
        <footer className="deck__meta">
          shared contract v{API_CLIENT_VERSION} · login: {login.status}
        </footer>
      </section>
    </main>
  );
}
