import { Button } from "@gtp/ui-primitives";
import { useAuth } from "@gtp/api-client";

// A new board is pre-seeded with the five built-in category lanes (+ Decided).
const BUILTIN_LANES = [
  "Dates",
  "Transport",
  "Stay",
  "Food",
  "Activities",
] as const;

/**
 * The authenticated boards view (empty for Phase 0.7). Expresses the Board
 * paradigm: a spatial canvas of category lanes rather than pages.
 */
export function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <main className="board">
      <header className="board__bar">
        <span className="board__brand">GTP · Trip Board</span>
        <div className="board__bar-actions">
          <Button type="button" variant="primary">
            ＋ New board
          </Button>
          <Button type="button" variant="secondary" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </header>

      <p className="board__eyebrow">Boards</p>
      <h1 className="board__title">Welcome, {user?.displayName}</h1>
      <p className="board__muted">
        No boards yet. Create your first one to start planning on the canvas.
      </p>

      <div className="board__canvas" aria-label="Empty board preview">
        {BUILTIN_LANES.map((lane) => (
          <section key={lane} className="lane">
            <h2 className="lane__title">{lane}</h2>
            <div className="lane__card lane__card--ghost">Add a card</div>
          </section>
        ))}
        <section className="lane lane--decided">
          <h2 className="lane__title">✦ Decided</h2>
          <div className="lane__card lane__card--ghost">
            Locked picks land here
          </div>
        </section>
      </div>
    </main>
  );
}
