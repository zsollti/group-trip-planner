import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canDeleteCategory,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useDeleteCategory,
  useDeleteOption,
  useRenameCategory,
  useStartDiscussion,
} from "@gtp/api-client";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { OptionForm } from "./OptionForm";
import { OptionCard } from "./OptionCard";
import { Menu } from "./Menu";

/**
 * One proposed option card, made sortable within its lane (Phase 3.5). The drag
 * listeners bind to a small **grip** in the card head — never the whole card — so
 * the vote control and the "⋯" menu keep working. Dragging is enabled only for
 * organizers on an active trip (`dndEnabled`); otherwise the card renders plain.
 */
function SortableOptionCard({
  tripId,
  category,
  option,
  myRole,
  myUserId,
  frozen,
  dndEnabled,
  onEdit,
  onDelete,
  deleting,
}: {
  tripId: string;
  category: CategoryView;
  option: OptionView;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  dndEnabled: boolean;
  onEdit: (o: OptionView) => void;
  onDelete: (o: OptionView) => void;
  deleting: boolean;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({
    id: option.id,
    data: { type: "card", categoryId: category.id },
    disabled: !dndEnabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };
  const grip = dndEnabled ? (
    <button
      type="button"
      className="lane__grip"
      aria-label={`Drag ${option.title} — reorder or drop on Decided to lock`}
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  ) : undefined;

  return (
    <OptionCard
      tripId={tripId}
      category={category}
      option={option}
      myRole={myRole}
      myUserId={myUserId}
      frozen={frozen}
      onEdit={onEdit}
      onDelete={onDelete}
      deleting={deleting}
      cardRef={setNodeRef}
      style={style}
      grip={grip}
      dragging={isDragging}
    />
  );
}

/** The lane header: an inline-editable name (organizers), the drag grip, and a
 *  "⋯" menu (Delete). Rename carries the version for the 409-reload path. */
function LaneHeader({
  tripId,
  category,
  isOrganizer,
  grip,
  onRequestDelete,
  onDiscuss,
  discussing,
}: {
  tripId: string;
  category: CategoryView;
  isOrganizer: boolean;
  grip?: ReactNode;
  onRequestDelete: () => void;
  onDiscuss: () => void;
  discussing: boolean;
}) {
  const rename = useRenameCategory(tripId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || name === category.name) {
      setEditing(false);
      return;
    }
    setError(null);
    try {
      await rename.mutateAsync({
        categoryId: category.id,
        name,
        version: category.version,
      });
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Changed elsewhere — reload."
          : err instanceof ApiError
            ? err.message
            : "Rename failed",
      );
    }
  }

  return (
    <>
      <div className="lane__head">
        {editing ? (
          <form className="lane__rename" onSubmit={submit}>
            <input
              data-gtp-input
              autoFocus
              aria-label={`Rename ${category.name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(category.name);
                  setEditing(false);
                }
              }}
            />
          </form>
        ) : (
          <h2 className="lane__title">
            {isOrganizer ? (
              <button
                type="button"
                className="lane__title-btn"
                title="Rename category"
                onClick={() => {
                  setDraft(category.name);
                  setEditing(true);
                }}
              >
                {category.name}
              </button>
            ) : (
              category.name
            )}
          </h2>
        )}
        <div className="lane__card-tools">
          {/* Start (or open) this category's discussion — any member (FR-29). */}
          <button
            type="button"
            className="lane__discuss"
            title={`Discuss ${category.name}`}
            aria-label={`Discuss ${category.name}`}
            disabled={discussing}
            onClick={onDiscuss}
          >
            💬
          </button>
          {grip}
          {/* Dates has no Delete: it is the trip's only date-setting path and
              cannot be recreated once gone (canDeleteCategory). With no other
              menu item, the whole "⋯" goes rather than offering a dead one. */}
          {isOrganizer && canDeleteCategory(category) ? (
            <Menu
              label={`${category.name} lane actions`}
              items={[
                {
                  label: "Delete category",
                  onSelect: onRequestDelete,
                  danger: true,
                },
              ]}
            />
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * One board lane = one category, rendering its **proposed** options as cards.
 * Locked options move to the global "Decided" column (Phase 3.5); this lane
 * receives only the proposed cards. The lane is a sortable item (drag its header
 * grip to reorder categories), its name is inline-editable, and a "⋯" menu deletes
 * it (organizers). Participant+ can add a card; the proposer or an Organizer
 * edits/deletes via each card's own menu.
 */
export function CategoryLane({
  tripId,
  category,
  options,
  defaultCurrency,
  myRole,
  myUserId,
  frozen = false,
  dndEnabled = false,
  laneDragEnabled = false,
  onOpenChannel,
}: {
  tripId: string;
  category: CategoryView;
  options: OptionView[];
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen?: boolean;
  /** Card gestures: lock/unlock and reorder within this lane. */
  dndEnabled?: boolean;
  /** Dragging the lane itself — off while the board sorts by "undecided first",
   *  where the displayed order is not the stored one. */
  laneDragEnabled?: boolean;
  /** Open the chat panel on this category's discussion channel (Phase 4.5). */
  onOpenChannel: (channelId: string) => void;
}) {
  const deleteOption = useDeleteOption(tripId, category.id);
  const deleteCategory = useDeleteCategory(tripId);
  const startDiscussion = useStartDiscussion(tripId);
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState<OptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOrganizer = can(myRole, "category.manage") && !frozen;

  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({
    id: `lane:${category.id}`,
    data: { type: "lane", categoryId: category.id },
    disabled: !laneDragEnabled,
  });
  const laneStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  async function onDelete(o: OptionView) {
    setError(null);
    try {
      await deleteOption.mutateAsync(o.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
    }
  }

  async function onDeleteCategory() {
    setError(null);
    try {
      await deleteCategory.mutateAsync(category.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not delete the category",
      );
    }
  }

  async function onDiscuss() {
    setError(null);
    try {
      // Idempotent: creates the category channel on first ask, else returns it.
      const channel = await startDiscussion.mutateAsync({
        categoryId: category.id,
      });
      onOpenChannel(channel.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not open the discussion",
      );
    }
  }

  const cardIds = options.map((o) => o.id);
  const laneGrip = laneDragEnabled ? (
    <button
      type="button"
      className="lane__grip lane__grip--lane"
      aria-label={`Drag to reorder the ${category.name} lane`}
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  ) : undefined;

  return (
    <section ref={setNodeRef} style={laneStyle} className="lane">
      <LaneHeader
        tripId={tripId}
        category={category}
        isOrganizer={isOrganizer}
        grip={laneGrip}
        onRequestDelete={() => setConfirmingDelete(true)}
        onDiscuss={onDiscuss}
        discussing={startDiscussion.isPending}
      />
      <p className="lane__meta">
        {category.singleChoice ? "single-choice" : "multi-select"}
      </p>

      {confirmingDelete ? (
        <div
          className="lane__confirm"
          role="alertdialog"
          aria-label="Delete category"
        >
          <p className="lane__confirm-text">
            Delete “{category.name}” and all its cards? This can’t be undone.
          </p>
          <div className="board__dialog-actions">
            <Button
              type="button"
              variant="secondary"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={deleteCategory.isPending}
              onClick={onDeleteCategory}
            >
              {deleteCategory.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      ) : null}

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {options.length === 0 ? (
          <div className="lane__card lane__card--ghost">No cards yet</div>
        ) : (
          options.map((o) => (
            <SortableOptionCard
              key={o.id}
              tripId={tripId}
              category={category}
              option={o}
              myRole={myRole}
              myUserId={myUserId}
              frozen={frozen}
              dndEnabled={dndEnabled}
              onEdit={setEditing}
              onDelete={onDelete}
              deleting={deleteOption.isPending}
            />
          ))
        )}
      </SortableContext>

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {can(myRole, "option.propose") && !frozen ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setProposing(true)}
        >
          + Add card
        </Button>
      ) : null}

      {proposing ? (
        <OptionForm
          tripId={tripId}
          categoryId={category.id}
          categoryBuiltinKey={category.builtinKey}
          currency={defaultCurrency}
          onClose={() => setProposing(false)}
        />
      ) : null}
      {editing ? (
        <OptionForm
          tripId={tripId}
          categoryId={category.id}
          categoryBuiltinKey={category.builtinKey}
          currency={editing.currency}
          option={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
