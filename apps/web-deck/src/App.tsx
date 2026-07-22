import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION } from "@gtp/api-client";

/**
 * UI A — Command Deck (placeholder shell).
 * Full command-palette workspace + auth land in Phase 0.7.
 */
export function App() {
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
          placeholder proves the app boots and the shared workspace resolves.
        </p>
        <Button variant="primary" className="deck__cta">
          Placeholder action
        </Button>
        <footer className="deck__meta">
          shared api-client contract v{API_CLIENT_VERSION}
        </footer>
      </section>
    </main>
  );
}
