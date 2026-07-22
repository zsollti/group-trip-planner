import { useEffect, useRef, useState } from "react";

export interface PaletteAction {
  label: string;
  run: () => void;
}

/**
 * The Deck's signature interaction: a ⌘K command palette. Minimal for Phase 0.7
 * (an empty workspace) — it lists the actions available so far and closes on
 * Escape. Keyboard focus lands on the search input when it opens.
 */
export function CommandPalette({
  actions,
  onClose,
}: {
  actions: PaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div
      className="deck__palette-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="deck__palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="deck__palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="deck__palette-list">
          {filtered.length === 0 ? (
            <li className="deck__palette-empty">No matching commands</li>
          ) : (
            filtered.map((action) => (
              <li key={action.label}>
                <button
                  className="deck__palette-item"
                  onClick={() => {
                    action.run();
                    onClose();
                  }}
                >
                  {action.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
