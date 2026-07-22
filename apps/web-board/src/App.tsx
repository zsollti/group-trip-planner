import { Button } from "@gtp/ui-primitives";
import { API_CLIENT_VERSION } from "@gtp/api-client";

const LANES = ["Dates", "Transport", "Stay", "✦ Decided"] as const;

/**
 * UI C — Trip Board (placeholder shell).
 * Full drag-and-drop canvas + auth land in Phase 0.7.
 */
export function App() {
  return (
    <main className="board">
      <header className="board__bar">
        <span className="board__brand">GTP · Trip Board</span>
        <Button variant="secondary" className="board__invite">
          Invite
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
        shared api-client contract v{API_CLIENT_VERSION}
      </p>
    </main>
  );
}
