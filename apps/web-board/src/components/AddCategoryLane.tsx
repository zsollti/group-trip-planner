import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { CATEGORY_NAME_MAX_LENGTH } from "@gtp/types";
import { ApiError, useCreateCategory } from "@gtp/api-client";

/**
 * The trailing "＋ Add category" lane (Phase 3.5) — replaces the old Categories
 * dialog with a board-native affordance at the end of the lane row (à la Trello's
 * "add list"). Organizers only; opens an inline form for the name + single-choice
 * flag and creates the category (which appends at the end).
 */
export function AddCategoryLane({ tripId }: { tripId: string }) {
  const create = useCreateCategory(tripId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [singleChoice, setSingleChoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await create.mutateAsync({ name: trimmed, singleChoice });
      setName("");
      setSingleChoice(false);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not add the category",
      );
    }
  }

  return (
    <section className="lane lane--add">
      {open ? (
        <form className="lane__add-form" onSubmit={submit}>
          <input
            data-gtp-input
            autoFocus
            aria-label="New category name"
            placeholder="Category name"
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <label className="board__checkbox">
            <input
              type="checkbox"
              checked={singleChoice}
              onChange={(e) => setSingleChoice(e.target.checked)}
            />
            Single-choice (only one locked pick)
          </label>
          {error ? (
            <p className="board__form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="board__dialog-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="lane__add-btn"
          onClick={() => setOpen(true)}
        >
          ＋ Add category
        </button>
      )}
    </section>
  );
}
