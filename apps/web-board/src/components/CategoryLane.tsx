import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canBeMultiSelect,
  canDeleteCategory,
  CATEGORY_NAME_MAX_LENGTH,
  maxCategoryOptions,
  type CategoryPaletteKey,
  type CategoryView,
  type OptionView,
  type TripDateRange,
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
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { isTruncated, truncateName } from "../lib/truncate";
import { CSS } from "@dnd-kit/utilities";
import { OptionForm } from "./OptionForm";
import { OptionCard } from "./OptionCard";
import { CategoryIcon } from "./CategoryIcon";
import { categoryHueStyle } from "../lib/categoryTheme";
import { Menu, type MenuItem } from "./Menu";
import { Dialog } from "./Dialog";
import { PalettePicker } from "./PalettePicker";
import { t } from "../lib/i18n";

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
  tripDates,
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
  tripDates: TripDateRange | null;
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
      aria-label={t("Drag {card} — reorder it, or drop it above to lock", {
        card: option.title,
      })}
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
      tripDates={tripDates}
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

/**
 * One **settled** card, made draggable so it can be dropped on the lane's unlock
 * strip.
 *
 * `useDraggable` rather than `useSortable`, which is the whole difference
 * between this and {@link SortableOptionCard}: a decision is pinned above the
 * lane's candidates and takes no part in their ordering, so there is nothing for
 * it to sort against and exactly one thing its drag can end in. Dropped
 * anywhere else it simply goes back, which is the right answer to an
 * overshoot — nothing on a settled card should be reachable by accident.
 */
function DraggableLockedCard({
  tripId,
  category,
  option,
  myRole,
  myUserId,
  frozen,
  tripDates,
  dndEnabled,
}: {
  tripId: string;
  category: CategoryView;
  option: OptionView;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  tripDates: TripDateRange | null;
  dndEnabled: boolean;
}) {
  const { setNodeRef, transform, attributes, listeners, isDragging } =
    useDraggable({
      id: option.id,
      data: { type: "locked", categoryId: category.id },
      disabled: !dndEnabled,
    });
  const style: CSSProperties = {
    // `Translate`, not `Transform`: a sortable is also scaled to the gap it is
    // moving into, and this card has no gap to move into.
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };
  const grip = dndEnabled ? (
    <button
      type="button"
      className="lane__grip"
      aria-label={t("Drag {card} — drop it below to unlock", {
        card: option.title,
      })}
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
      tripDates={tripDates}
      cardRef={setNodeRef}
      style={style}
      grip={grip}
      dragging={isDragging}
      settled
    />
  );
}

/** The lane header: an inline-editable name (organizers), the drag grip, and a
 *  "⋯" menu (Delete). Rename carries the version for the 409-reload path. */
function LaneHeader({
  tripId,
  category,
  isOrganizer,
  canDiscuss,
  grip,
  onRequestDelete,
  onDiscuss,
  discussing,
}: {
  tripId: string;
  category: CategoryView;
  isOrganizer: boolean;
  /** Whether this reader has the board's chat at all — a Guest does not. */
  canDiscuss: boolean;
  grip?: ReactNode;
  onRequestDelete: () => void;
  onDiscuss: () => void;
  discussing: boolean;
}) {
  const update = useUpdateCategory(tripId);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  /**
   * Write the category, keeping whichever fields this edit isn't changing.
   *
   * The endpoint is a full replace, so a rename has to carry the current
   * selection mode and colour and vice versa — otherwise renaming a lane would
   * quietly reset how it decides, or repaint it.
   *
   * `paletteKey` is why the shape is `{ ... } | undefined` per field rather than
   * a partial spread of the category: null is a *value* here (put this lane back
   * to its own colour), so "absent" and "null" cannot be the same thing.
   *
   * The 409 is two different things and they need different words: a version
   * clash is "someone else got there first", while a refused selection-mode
   * change is a rule the server is explaining (Dates, or too many locked
   * options). Only the first is fixed by reloading, so the server's own message
   * is shown whenever it has one to give.
   */
  async function save(next: {
    name?: string;
    singleChoice?: boolean;
    paletteKey?: CategoryPaletteKey | null;
  }) {
    setError(null);
    try {
      await update.mutateAsync({
        categoryId: category.id,
        name: next.name ?? category.name,
        singleChoice: next.singleChoice ?? category.singleChoice,
        paletteKey:
          "paletteKey" in next
            ? (next.paletteKey ?? null)
            : category.paletteKey,
        version: category.version,
      });
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("Could not update this category"),
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

  /*
   * The lane's "⋯", built from what *this* reader may do to *this* lane.
   *
   * Discuss leads and is not an organizer's privilege (FR-29) — but it is a
   * *chat* privilege, and post-launch a Guest has none, so it is filtered like
   * everything else here rather than assumed. It used to be a 💬 button of its
   * own beside the menu, which is why the menu could be dropped whenever a
   * reader had no organizer items — the header always had one control. Folding
   * the two together means the menu is now the header's only control, so it
   * renders for everyone and *filters* rather than disappears: hiding it for a
   * participant would take category chat with it.
   *
   * Colour leads the organizer half: it is the only one every lane has, Dates
   * included.
   */
  const laneMenuItems: MenuItem[] = [];
  if (canDiscuss) {
    laneMenuItems.push({
      label: t("Discuss"),
      onSelect: onDiscuss,
      disabled: discussing,
    });
  }
  if (isOrganizer) {
    laneMenuItems.push({
      label: t("Change colour"),
      separated: true,
      onSelect: () => setPicking(true),
    });
    if (canBeMultiSelect(category)) {
      laneMenuItems.push({
        label: category.singleChoice
          ? t("Allow multi-select")
          : t("Allow single-select"),
        onSelect: () => void save({ singleChoice: !category.singleChoice }),
        disabled: update.isPending,
      });
    }
    if (canDeleteCategory(category)) {
      laneMenuItems.push({
        label: t("Delete category"),
        onSelect: onRequestDelete,
        danger: true,
      });
    }
  }

  return (
    <>
      {/* Everything that identifies the lane pins together.
       *
       * The name was sticky and the single-choice/multi-select line under it was
       * not, so scrolling a lane slid the mode label up **behind** the name — a
       * label half-covered by the heading it belongs to — and then away
       * entirely, leaving a column of near-identical cards with no statement of
       * how the lane decides. They answer one question between them ("which
       * lane is this, and how does it pick a winner?"), so they pin as one
       * block.
       *
       * This element carries the lane's top padding, which `.lane` no longer
       * has. That is not cosmetic: a sticky box whose static position is above
       * its `top` offset jumps down to meet it the moment you scroll, and the
       * old `margin-top: -0.85rem` put it exactly 0.85rem above `top: 0`. The
       * header sat flush under the lane's coloured border at rest and dropped a
       * lane's-padding gap as soon as you moved — a gap the cards then scrolled
       * through, between the border and the name. With the padding here, static
       * and stuck are the same place and there is nothing to jump. */}
      <div className="lane__pin">
        <div className="lane__head">
          {/* Outside the editing branch on purpose: a lane keeps its identity
            while you are renaming it, and a mark that vanishes the moment you
            click the title reads as something breaking. */}
          <CategoryIcon category={category} className="lane__icon" />
          {editing ? (
            <form className="lane__rename" onSubmit={submit}>
              <input
                data-gtp-input
                autoFocus
                aria-label={t("Rename {lane}", { lane: category.name })}
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
                  aria-label={t("{lane} — rename category", {
                    lane: category.name,
                  })}
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
            {grip}
            {/* Dates still gets neither of the two edit items: it is the trip's
              only date-setting path and cannot be recreated once gone
              (canDeleteCategory), and it holds one date range so it cannot go
              multi-select (canBeMultiSelect). Its menu is Discuss and a colour,
              which is why it has one at all.

              And the menu itself goes when there is nothing left in it, which
              post-launch is a real state rather than a defensive one: a Guest
              has no organizer items and no chat, so the trigger would open an
              empty card. */}
            {laneMenuItems.length > 0 ? (
              <Menu
                label={t("{lane} lane actions", { lane: category.name })}
                items={laneMenuItems}
              />
            ) : null}
          </div>
        </div>
        <p className="lane__meta">
          {category.singleChoice ? t("Single-select") : t("Multi-select")}
        </p>
      </div>
      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}
      {picking ? (
        <PalettePicker
          category={category}
          busy={update.isPending}
          error={error}
          onPick={async (paletteKey) => {
            // Closed only on success: a refused write (a stale version, most
            // likely) keeps the dialog open and shows the reason inside it,
            // rather than dismissing itself as though it had worked and
            // leaving the explanation behind the backdrop.
            if (await save({ paletteKey })) setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
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
  tripDates = null,
  dndEnabled = false,
  decideTarget = false,
  unlockTarget = false,
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
   * The rail is now gone entirely and this is the only place a decision
   * appears on the board. That was the argument for removing it: once a lane
   * carried its own answer, the rail was a second copy of every decision,
   * directly above the first.
   */
  decided: OptionView[];
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen?: boolean;
  /** The trip's settled range, for the "outside the trip's dates" hint. */
  tripDates?: TripDateRange | null;
  /**
   * Drag gestures: lock/unlock and reorder within this lane, and dragging the
   * lane itself among its neighbours.
   *
   * One flag, because there is one answer. Lane drag used to have its own, held
   * off while the board offered a "sort by undecided" view whose displayed order
   * was not the stored one — a drag there would have written the indices the
   * reader saw instead of the ones the server keeps. That view is gone, so the
   * two flags could only ever agree.
   */
  dndEnabled?: boolean;
  /**
   * Show this lane's "drop to decide" target — true only while one of *its own*
   * proposed cards is in hand.
   *
   * It exists only during that drag on purpose. A target that is always there
   * would be a second, permanently-visible way to do what the "⋯" menu already
   * does, in a column where vertical space is the scarce resource; and a lane
   * whose whole body accepted a drop would turn an overshot reorder into an
   * accidental decision, which is the one gesture here that shouldn't be
   * cheap to trigger by mistake.
   */
  decideTarget?: boolean;
  /**
   * Show this lane's "drop to unlock" target — true only while one of *its own*
   * settled cards is in hand.
   *
   * The mirror of {@link decideTarget}, and mutually exclusive with it: a card
   * in hand is either locked or it is not, so a lane never offers both strips
   * at once and neither is ever on at rest.
   */
  unlockTarget?: boolean;
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

  // How full the lane is, counted the way the server counts it: every live
  // option, decisions included. A locked card is pinned at the top of the lane
  // taking its room, so a cap that ignored it would be a different limit from
  // the one the API enforces — and the board would offer a form that 403s.
  const optionCap = maxCategoryOptions();
  const laneIsFull = options.length + decided.length >= optionCap;

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
    disabled: !dndEnabled,
  });
  const laneStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    // Inherited by everything in the lane — header, cards, the add button — so
    // one number decides the whole column's colour.
    ...categoryHueStyle(category),
  };

  async function onDelete(o: OptionView) {
    setError(null);
    try {
      await deleteOption.mutateAsync(o.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Could not delete"));
    }
  }

  async function onDeleteCategory() {
    setError(null);
    try {
      await deleteCategory.mutateAsync(category.id);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("Could not delete the category"),
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
        err instanceof ApiError
          ? err.message
          : t("Could not open the discussion"),
      );
    }
  }

  /**
   * Where a card is dropped to become this lane's decision.
   *
   * The Decided rail used to be this target: one strip, at the top of the
   * board, for every lane. Losing it did not have to mean losing the gesture,
   * and the replacement is a shorter drag — the answer belongs at the top of
   * the question it answers, so that is where the card goes.
   */
  const decideDrop = useDroppable({
    id: `decide:${category.id}`,
    data: { type: "decide", categoryId: category.id },
    disabled: !decideTarget,
  });

  /**
   * Where a settled card is dropped to reopen the question.
   *
   * Below the decisions and above "Also proposed", because that is the seam
   * between the two halves of the lane and the card is about to cross it: drag
   * it down out of the settled block and it lands among the candidates again.
   * Like the decide strip it exists only for the length of its own drag, so a
   * lane at rest is unchanged and a decision still cannot be undone by a slip.
   */
  const unlockDrop = useDroppable({
    id: `unlock:${category.id}`,
    data: { type: "unlock", categoryId: category.id },
    disabled: !unlockTarget,
  });

  const cardIds = options.map((o) => o.id);
  const laneGrip = dndEnabled ? (
    <button
      type="button"
      className="lane__grip lane__grip--lane"
      aria-label={t("Drag to reorder the {lane} lane", { lane: category.name })}
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
      // Where the guided tour begins — it points at the first lane on the
      // board, whichever that turns out to be. See `lib/tour`.
      data-tour="lane"
    >
      <LaneHeader
        tripId={tripId}
        category={category}
        isOrganizer={isOrganizer}
        canDiscuss={can(myRole, "message.post")}
        grip={laneGrip}
        onRequestDelete={() => setConfirmingDelete(true)}
        onDiscuss={onDiscuss}
        discussing={startDiscussion.isPending}
      />

      {/*
       * The same confirm the trip's own Delete gets — a modal, not a strip
       * wedged into the top of the column.
       *
       * The inline panel put the question inside the thing it was asking about,
       * in a 15rem column that scrolls: open it on a lane scrolled halfway down
       * the board and the confirmation appeared above the fold you were not
       * looking at, or pushed the lane's cards down while you read it. Deleting
       * a lane takes every card in it with it, which is the same weight as
       * deleting the trip, and it now asks in the same voice and in the same
       * place on the screen.
       *
       * No Cancel, for the reason the trip's confirm has none: the way out is
       * the ✕ in the corner of every dialog in this app, and Escape.
       */}
      {confirmingDelete ? (
        <Dialog
          title={t("Delete “{lane}”?", { lane: category.name })}
          describedById={`lane-delete-blurb-${category.id}`}
          onClose={() => setConfirmingDelete(false)}
        >
          <p className="board__muted" id={`lane-delete-blurb-${category.id}`}>
            {t(
              "This removes the lane and every card in it. This can’t be undone.",
            )}
          </p>
          <div className="board__dialog-actions">
            <Button
              type="button"
              variant="primary"
              disabled={deleteCategory.isPending}
              onClick={onDeleteCategory}
            >
              {deleteCategory.isPending ? t("Deleting…") : t("Delete")}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {/* Above the settled cards, because that is where the dropped card is
          about to appear. Rendered only mid-drag (see `decideTarget`).

          One word for both kinds of lane. It used to say "decide" on a
          single-select lane and "lock" on a multi-select one, which named the
          consequence rather than the gesture and left the board with two words
          for the padlock the card is about to wear. The lane already states
          how it picks a winner, one line under its own name. */}
      {decideTarget ? (
        <div
          ref={decideDrop.setNodeRef}
          className={
            "lane__decide-drop" +
            (decideDrop.isOver ? " lane__decide-drop--over" : "")
          }
          aria-hidden="true"
        >
          {decideDrop.isOver ? t("Drop to lock") : t("Drop here to lock")}
        </div>
      ) : null}

      {/* Settled first, and outside the SortableContext: a decision is no longer
          a candidate, so it takes no part in the lane's ordering. It does carry
          a grip — dragging it onto the strip below reopens the question — but
          that grip is not a sortable one, and every settled card keeps Unlock
          on its "⋯" whether or not drag is available. Drag stays the second
          way to do a thing, never the only one. */}
      {decided.map((o) => (
        <DraggableLockedCard
          key={o.id}
          tripId={tripId}
          category={category}
          option={o}
          myRole={myRole}
          myUserId={myUserId}
          frozen={frozen}
          tripDates={tripDates}
          dndEnabled={dndEnabled}
        />
      ))}

      {/* Between the two halves of the lane, so the drop reads as the card
          crossing back over. Rendered only mid-drag (see `unlockTarget`), and
          it stands in for the "Also proposed" label while it is there rather
          than pushing it down: they mark the same seam. */}
      {unlockTarget ? (
        <div
          ref={unlockDrop.setNodeRef}
          className={
            "lane__decide-drop lane__decide-drop--unlock" +
            (unlockDrop.isOver ? " lane__decide-drop--over" : "")
          }
          aria-hidden="true"
        >
          {unlockDrop.isOver ? t("Drop to unlock") : t("Drop here to unlock")}
        </div>
      ) : null}

      {decided.length > 0 && options.length > 0 && !unlockTarget ? (
        <p className="lane__alt-head">{t("Also proposed")}</p>
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
              data-tour="propose"
              onClick={() => setProposing(true)}
            >
              {t("＋ Propose the first option")}
            </button>
          ) : (
            <div className="lane__card lane__card--ghost">
              {frozen ? t("Nothing was decided here") : t("No options yet")}
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
              tripDates={tripDates}
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

      {/* Hidden only on a genuinely untouched lane, where the ghost card is
          already the CTA and two identical actions stacked reads as a mistake.

          A multi-select lane whose options are *all* locked used to fall
          through both: no ghost card (it holds a decision, so it is not empty)
          and no button (it has no proposed cards), leaving a lane you are
          expressly meant to keep adding to with nowhere to add. A single-choice
          lane still hides it once decided — that question has its answer, and
          reconsidering starts by unlocking. */}
      {canPropose &&
      (options.length > 0 || (decided.length > 0 && !category.singleChoice)) ? (
        laneIsFull ? (
          /* Said, not silently withheld. A button that vanished at the cap
             would read as the board losing an action, and the reader would go
             looking for the setting that took it away; the sentence names the
             limit and the way out of it. Deliberately not `role="alert"` — the
             lane is full, which is a state, not something that just went
             wrong. */
          <p className="lane__full">
            {t("Full at {cap} options. Remove one to add another.", {
              cap: optionCap,
            })}
          </p>
        ) : (
          <Button
            type="button"
            variant="secondary"
            // The other half of the tour's "propose" anchor: an empty lane
            // shows the ghost card above, a filled one shows this. Exactly one
            // of the two is ever on screen per lane.
            data-tour="propose"
            onClick={() => setProposing(true)}
          >
            {t("+ Add card")}
          </Button>
        )
      ) : null}

      {proposing ? (
        <OptionForm
          tripId={tripId}
          categoryId={category.id}
          categoryBuiltinKey={category.builtinKey}
          currency={defaultCurrency}
          tripDates={tripDates}
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
          tripDates={tripDates}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
