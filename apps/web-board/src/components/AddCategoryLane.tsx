import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { CATEGORY_NAME_MAX_LENGTH, maxTripCategories } from "@gtp/types";
import { ApiError, useCreateCategory } from "@gtp/api-client";
import { t } from "../lib/i18n";

/**
 * The trailing "＋ Add category" lane (Phase 3.5) — replaces the old Categories
 * dialog with a board-native affordance at the end of the lane row (à la Trello's
 * "add list"). Organizers only; opens an inline form for the name + single-choice
 * flag and creates the category (which appends at the end).
 *
 * At the policy-layer cap (`maxTripCategories`) the tile states the limit instead
 * of offering the form: an affordance must never propose an action the server
 * would refuse (`docs/ui-audit.md` §3). The server enforces the cap regardless —
 * this is the explanation, not the enforcement.
 */
export function AddCategoryLane({
  tripId,
  categoryCount,
}: {
  tripId: string;
  /** How many categories the trip already has, built-ins included. */
  categoryCount: number;
}) {
  const create = useCreateCategory(tripId);
  const cap = maxTripCategories();
  const atCap = categoryCount >= cap;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Matches the contract's default: a category is a question, so one answer
  // unless you say otherwise. Reversible from the lane's own menu either way.
  const [singleChoice, setSingleChoice] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await create.mutateAsync({ name: trimmed, singleChoice });
      setName("");
      setSingleChoice(true);
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
            aria-label={t("New category name")}
            placeholder={t("Category name")}
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
              checked={!singleChoice}
              onChange={(e) => setSingleChoice(!e.target.checked)}
            />
            {t("Allow several winners")}
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
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      ) : atCap ? (
        <p className="lane__add-cap">
          {t("{cap} categories is the maximum. Delete one to add another.", {
            cap,
          })}
        </p>
      ) : (
        <button
          type="button"
          className="lane__add-btn"
          onClick={() => setOpen(true)}
        >
          {t("＋ Add category")}
        </button>
      )}
    </section>
  );
}
