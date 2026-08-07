import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canBeMultiSelect,
  canDeleteCategory,
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useDeleteCategory,
  useDeleteOption,
  useUpdateCategory,
  useStartDiscussion,
} from "@gtp/api-client";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { isTruncated, truncateName } from "../lib/truncate";
import { CSS } from "@dnd-kit/utilities";
import { OptionForm } from "./OptionForm";
import { OptionCard } from "./OptionCard";
import { Menu, type MenuItem } from "./Menu";

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
  const update = useUpdateCategory(tripId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  /**
   * Write the category, keeping whichever field this edit isn't changing.
   *
   * The endpoint is a full replace, so a rename has to carry the current
   * selection mode and vice versa — otherwise renaming a lane would quietly
   * reset how it decides.
   *
   * The 409 is two different things and they need different words: a version
   * clash is "someone else got there first", while a refused selection-mode
   * change is a rule the server is explaining (Dates, or too many locked
   * options). Only the first is fixed by reloading, so the server's own message
   * is shown whenever it has one to give.
   */
  async function save(next: { name?: string; singleChoice?: boolean }) {
    setError(null);
    try {
      await update.mutateAsync({
        categoryId: category.id,
        name: next.name ?? category.name,
        singleChoice: next.singleChoice ?? category.singleChoice,
        version: category.version,
      });
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update this category",
      );
      return false;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || name === category.name) {
      setEditing(false);
      return;
    }
    if (await save({ name })) setEditing(false);
  }

  // Built once so the "⋯" can be dropped entirely when it would be empty.
  const laneMenuItems: MenuItem[] = [];
  if (canBeMultiSelect(category)) {
    laneMenuItems.push({
      label: category.singleChoice
        ? "Allow several winners"
        : "Keep only one winner",
      onSelect: () => void save({ singleChoice: !category.singleChoice }),
      disabled: update.isPending,
    });
  }
  if (canDeleteCategory(category)) {
    laneMenuItems.push({
      label: "Delete category",
      onSelect: onRequestDelete,
      danger: true,
    });
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
              maxLength={CATEGORY_NAME_MAX_LENGTH}
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
          // The header shows a shortened name with the full one on `title`, so a
          // long name can't stretch the lane but stays readable on hover — and
          // the h2's aria-label keeps it intact for a screen reader.
          <h2
            className="lane__title"
            id={`lane-title-${category.id}`}
            aria-label={category.name}
          >
            {isOrganizer ? (
              <button
                type="button"
                className="lane__title-btn"
                title={category.name}
                aria-label={`${category.name} — rename category`}
                onClick={() => {
                  setDraft(category.name);
                  setEditing(true);
                }}
              >
                {truncateName(category.name)}
              </button>
            ) : (
              <span
                title={isTruncated(category.name) ? category.name : undefined}
              >
                {truncateName(category.name)}
              </span>
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
          {/* Dates gets neither item: it is the trip's only date-setting path
              and cannot be recreated once gone (canDeleteCategory), and it holds
              one date range so it cannot go multi-select (canBeMultiSelect).
              With nothing to offer, the whole "⋯" goes rather than showing a
              menu of things that would be refused. */}
          {isOrganizer && laneMenuItems.length > 0 ? (
            <Menu
              label={`${category.name} lane actions`}
              items={laneMenuItems}
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
  decided,
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
  /**
   * This lane's **locked** options, pinned above the open ones.
   *
   * A decision used to leave its lane entirely and live only in the Decided
   * rail, which meant a lane showed the options a group rejected and not the one
   * it chose — the comparison the lane exists for, missing its conclusion. It
   * also drove the lane into its empty state, so a settled question offered
   * "Propose the first option", and an ended trip said "Nothing was decided
   * here" about a lane where something plainly was.
   *
   * The rail still carries them too. The two are not duplicates: the lane answers
   * "what did we pick, and over what?", the rail answers "what does this trip
   * look like now?".
   */
  decided: OptionView[];
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
  const canPropose = can(myRole, "option.propose") && !frozen;

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
    /* Named after its heading rather than with a duplicated `aria-label`, the
       same rule the dialogs follow — the heading already carries the full
       category name where the visible text is truncated, so the two cannot
       drift. This matters more since a decision started appearing in both its
       lane and the rail: "which Beach House" is now a real question, for a
       screen reader reading landmarks and for a test locating one. */
    <section
      ref={setNodeRef}
      style={laneStyle}
      className="lane"
      aria-labelledby={`lane-title-${category.id}`}
    >
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

      {/* Settled first, and outside the SortableContext: a decision is no longer
          a candidate, so it takes no part in the lane's ordering and carries no
          drag grip. Unlock is still on its own "⋯", the same action the rail
          chip offers — both go through `useUnlockAction`, so they cannot
          diverge. */}
      {decided.map((o) => (
        <OptionCard
          key={o.id}
          tripId={tripId}
          category={category}
          option={o}
          myRole={myRole}
          myUserId={myUserId}
          frozen={frozen}
          settled
        />
      ))}
      {decided.length > 0 && options.length > 0 ? (
        <p className="lane__alt-head">Also proposed</p>
      ) : null}

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {options.length === 0 ? (
          /* Empty only when nothing at all is here — a lane holding a decision
             is not empty, it is answered.

             An empty lane is where a new board spends most of its first
             minutes, so it names the next action rather than just reporting
             emptiness — and says why when there isn't one (Phase 6.4). */
          decided.length > 0 ? null : canPropose ? (
            <button
              type="button"
              className="lane__card lane__card--ghost lane__card--cta"
              onClick={() => setProposing(true)}
            >
              ＋ Propose the first option
            </button>
          ) : (
            <div className="lane__card lane__card--ghost">
              {frozen ? "Nothing was decided here" : "No options yet"}
            </div>
          )
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

      {/* Hidden while the lane is empty: the ghost card is already the CTA
          there, and two identical actions stacked reads as a mistake. */}
      {canPropose && options.length > 0 ? (
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
