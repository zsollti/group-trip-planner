import { useEffect, useState } from "react";
import { useAuth } from "@gtp/api-client";
import { CommandPalette } from "../components/CommandPalette";

/**
 * The authenticated workspace (empty for Phase 0.7). Expresses the Deck
 * paradigm: a persistent console shell driven by the ⌘K command palette.
 */
export function Dashboard() {
  const { user, logout } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="deck">
      <header className="deck__bar">
        <span className="deck__brand">GTP · COMMAND DECK</span>
        <button
          type="button"
          className="deck__kbd"
          onClick={() => setPaletteOpen(true)}
        >
          ⌘K
        </button>
      </header>
      <section className="deck__body deck__empty">
        <p className="deck__eyebrow">Workspace</p>
        <h1 className="deck__title">Welcome, {user?.displayName}</h1>
        <p className="deck__lede">
          No trips yet. Press <kbd className="deck__kbd">⌘K</kbd> to open the
          command palette.
        </p>
      </section>
      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={[{ label: "Log out", run: () => void logout() }]}
        />
      ) : null}
    </main>
  );
}
