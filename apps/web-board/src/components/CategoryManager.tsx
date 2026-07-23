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
 * Board-paradigm category editor: a floating card for Organizers to add, rename,
 * reorder, and delete the trip's lanes/categories (SRS §6 / FR-18–20). Rename
 * carries the category `version` — a 409 surfaces the "changed since you opened
 * it — reload" prompt. Reorder sends the full ordered id set (up/down controls).
 * Deleting warns the lane's discussion is lost for good (hard cascade).
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
    <div className="board__backdrop" role="presentation" onClick={onClose}>
      <div
        className="board__dialog board__dialog--tall"
        role="dialog"
        aria-modal="true"
        aria-label="Categories"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="board__eyebrow">Plan</p>
        <h2 className="board__title">Categories</h2>

        {categories.isPending ? (
          <p className="board__muted">Loading categories…</p>
        ) : categories.isError ? (
          <p className="board__form-error" role="alert">
            Couldn't load categories.
          </p>
        ) : (
          <ul className="board__invite-items">
            {list.map((cat, index) => (
              <li key={cat.id} className="board__invite-item">
                {editingId === cat.id ? (
                  <div className="board__cat-edit">
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
                      <span className="board__muted">
                        {cat.singleChoice ? "single-choice" : "multi-select"}
                        {cat.isBuiltin ? " · built-in" : ""}
                      </span>
                    </div>
                    <div className="board__invite-item-actions">
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
          <p className="board__form-error" role="alert">
            {error}
          </p>
        ) : null}

        {confirmingDelete ? (
          <div className="board__confirm">
            <p className="board__muted">
              Delete “{confirmingDelete.name}”? Its cards, votes, and discussion
              are permanently removed — this can't be undone.
            </p>
            <div className="board__dialog-actions">
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
          <form onSubmit={onCreate} noValidate className="board__cat-create">
            <Field htmlFor="cat-name" label="New category">
              <Input
                id="cat-name"
                placeholder="e.g. Packing list"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <label className="board__checkbox">
              <input
                type="checkbox"
                checked={singleChoice}
                onChange={(e) => setSingleChoice(e.target.checked)}
              />
              <span>Single-choice (locking one card unlocks the rest)</span>
            </label>
            <div className="board__dialog-actions">
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
