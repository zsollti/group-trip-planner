import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION } from "@gtp/api-client";

/**
 * UI B — Trip Feed (placeholder shell).
 * Full bottom-tab social app + auth wizard land in Phase 0.7.
 */
export function App() {
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
        <Button variant="primary" className="feed__cta">
          Placeholder action
        </Button>
        <p className="feed__meta">
          shared api-client contract v{API_CLIENT_VERSION}
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
