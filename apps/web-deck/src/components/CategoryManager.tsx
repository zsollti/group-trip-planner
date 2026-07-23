import { useEffect, useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import type { CategoryView } from "@gtp/types";
import {
  ApiError,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useReorderCategories,
  useTripCategories,
} from "@gtp/api-client";

/**
 * Deck-paradigm category console: a command dialog for Organizers to add, rename,
 * reorder, and delete the trip's planning categories (SRS §6 / FR-18–20). Rename
 * carries the category `version` — a 409 surfaces the "changed since you opened
 * it — reload" prompt. Reorder sends the full ordered id set (up/down controls).
 * Deleting warns that the category's discussion is lost for good (hard cascade).
 */
export function CategoryManager({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const categories = useTripCategories(tripId);
  const createCategory = useCreateCategory(tripId);
  const renameCategory = useRenameCategory(tripId);
  const deleteCategory = useDeleteCategory(tripId);
  const reorder = useReorderCategories(tripId);

  const [name, setName] = useState("");
  const [singleChoice, setSingleChoice] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<CategoryView | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function report(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createCategory.mutateAsync({ name: name.trim(), singleChoice });
      setName("");
      setSingleChoice(false);
    } catch (err) {
      report(err, "Could not create the category");
    }
  }

  function startEdit(cat: CategoryView) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setError(null);
  }

  async function onSaveRename(cat: CategoryView) {
    setError(null);
    try {
      await renameCategory.mutateAsync({
        categoryId: cat.id,
        name: editName.trim(),
        version: cat.version,
      });
      setEditingId(null);
    } catch (err) {
      report(err, "Could not rename the category");
    }
  }

  async function onMove(list: CategoryView[], index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    setError(null);
    try {
      await reorder.mutateAsync({ orderedIds: ids });
    } catch (err) {
      report(err, "Could not reorder");
    }
  }

  async function onConfirmDelete() {
    if (!confirmingDelete) return;
    setError(null);
    try {
      await deleteCategory.mutateAsync(confirmingDelete.id);
      setConfirmingDelete(null);
    } catch (err) {
      report(err, "Could not delete the category");
    }
  }

  const list = categories.data ?? [];

  return (
    <div
      className="deck__palette-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="deck__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Categories"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="deck__eyebrow">Plan</p>
        <h2 className="deck__dialog-title">Categories</h2>

        {categories.isPending ? (
          <p className="deck__muted">Loading categories…</p>
        ) : categories.isError ? (
          <p className="deck__form-error" role="alert">
            Couldn't load categories.
          </p>
        ) : (
          <ul className="deck__invite-items">
            {list.map((cat, index) => (
              <li key={cat.id} className="deck__invite-item">
                {editingId === cat.id ? (
                  <div className="deck__cat-edit">
                    <Input
                      aria-label={`Rename ${cat.name}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="primary"
                      disabled={renameCategory.isPending || !editName.trim()}
                      onClick={() => onSaveRename(cat)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{cat.name}</strong>{" "}
                      <span className="deck__badge">
                        {cat.singleChoice ? "Single-choice" : "Multi-select"}
                      </span>
                      {cat.isBuiltin ? (
                        <span className="deck__muted"> · built-in</span>
                      ) : null}
                    </div>
                    <div className="deck__invite-item-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${cat.name} up`}
                        disabled={index === 0 || reorder.isPending}
                        onClick={() => onMove(list, index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${cat.name} down`}
                        disabled={
                          index === list.length - 1 || reorder.isPending
                        }
                        onClick={() => onMove(list, index, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => startEdit(cat)}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setConfirmingDelete(cat)}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p className="deck__form-error" role="alert">
            {error}
          </p>
        ) : null}

        {confirmingDelete ? (
          <div className="deck__confirm">
            <p className="deck__muted">
              Delete “{confirmingDelete.name}”? Its options, votes, and
              discussion are permanently removed — this can't be undone.
            </p>
            <div className="deck__dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={deleteCategory.isPending}
                onClick={onConfirmDelete}
              >
                Delete category
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onCreate} noValidate className="deck__cat-create">
            <Field htmlFor="cat-name" label="New category">
              <Input
                id="cat-name"
                placeholder="e.g. Packing list"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <label className="deck__checkbox">
              <input
                type="checkbox"
                checked={singleChoice}
                onChange={(e) => setSingleChoice(e.target.checked)}
              />
              <span>Single-choice (locking one option unlocks the rest)</span>
            </label>
            <div className="deck__dialog-actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={createCategory.isPending || !name.trim()}
              >
                {createCategory.isPending ? "Adding…" : "Add category"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
