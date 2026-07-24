import { useState, type CSSProperties, type ReactNode } from "react";
import {
  can,
  canManageOption,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import { ApiError, useLockOption, useUnlockOption } from "@gtp/api-client";
import { Menu, type MenuItem } from "./Menu";
import { VoteDots } from "./optionControls";
import { costLabel, dateRangeLabel } from "./optionFormat";

/**
 * One option card (Phase 3.5) — the presentational card shared by the category
 * lanes (proposed) and the global Decided column (locked). Content-first: title,
 * dates, cost, notes, link, proposer, then the public vote tally. All *actions*
 * (Edit, Delete, and Lock/"Move to Decided"/Unlock) collapse into a single "⋯"
 * menu so a lane of 20 cards isn't a wall of buttons — drag stays the primary
 * lock gesture, the menu is the non-drag fallback. The menu is omitted entirely
 * for viewers with no available action. Optional DnD bindings (`cardRef`, `style`,
 * `grip`, `dragging`) let a sortable/draggable wrapper lift the card.
 */
export function OptionCard({
  tripId,
  category,
  option,
  myRole,
  myUserId,
  frozen,
  onEdit,
  onDelete,
  deleting = false,
  cardRef,
  style,
  grip,
  dragging = false,
  categoryTag,
}: {
  tripId: string;
  category: CategoryView;
  option: OptionView;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  onEdit?: (o: OptionView) => void;
  onDelete?: (o: OptionView) => void;
  deleting?: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  style?: CSSProperties;
  grip?: ReactNode;
  dragging?: boolean;
  categoryTag?: string;
}) {
  const lock = useLockOption(tripId, category.id);
  const unlock = useUnlockOption(tripId, category.id);
  const [actionError, setActionError] = useState<string | null>(null);

  const manageable = canManageOption(myRole, option.proposerId === myUserId);
  const canDecide = can(myRole, "decision.lock") && !frozen;
  const locked = option.status === "LOCKED";
  const dates = dateRangeLabel(option.startsAt, option.endsAt);

  async function doLock() {
    setActionError(null);
    try {
      await lock.mutateAsync({
        optionId: option.id,
        optionVersion: option.version,
        categoryVersion: category.version,
      });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not lock");
    }
  }
  async function doUnlock() {
    setActionError(null);
    try {
      await unlock.mutateAsync({
        optionId: option.id,
        version: option.version,
      });
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Could not unlock",
      );
    }
  }

  const items: MenuItem[] = [];
  if (manageable && !frozen && !locked && onEdit) {
    items.push({ label: "Edit", onSelect: () => onEdit(option) });
  }
  if (canDecide) {
    items.push(
      locked
        ? { label: "Unlock", onSelect: doUnlock, disabled: unlock.isPending }
        : {
            label: category.singleChoice ? "Move to Decided" : "Lock card",
            onSelect: doLock,
            disabled: lock.isPending,
          },
    );
  }
  if (manageable && !frozen && !locked && onDelete) {
    items.push({
      label: "Delete",
      onSelect: () => onDelete(option),
      danger: true,
      disabled: deleting,
    });
  }

  // Click-to-edit (Phase 3.5): the shown parameters open the full form for those
  // who can edit this option (proposer/organizer, not locked/frozen); otherwise
  // they render as plain read-only text.
  const editable = Boolean(onEdit) && manageable && !frozen && !locked;
  const openEdit = () => onEdit?.(option);
  const field = (className: string, content: ReactNode) =>
    editable ? (
      <button
        type="button"
        className="lane__field-btn"
        title="Edit option"
        onClick={openEdit}
      >
        <span className={className}>{content}</span>
      </button>
    ) : (
      <p className={className}>{content}</p>
    );

  return (
    <article
      ref={cardRef}
      style={style}
      className={
        "lane__card lane__card--option" +
        (categoryTag ? " lane__card--decided" : "") +
        (dragging ? " lane__card--dragging" : "")
      }
    >
      <div className="lane__card-head">
        <strong>
          {editable ? (
            <button
              type="button"
              className="lane__field-btn"
              title="Edit option"
              onClick={openEdit}
            >
              {option.title}
            </button>
          ) : (
            option.title
          )}
        </strong>
        <div className="lane__card-tools">
          {grip}
          {items.length > 0 ? (
            <Menu label={`Actions for ${option.title}`} items={items} />
          ) : null}
        </div>
      </div>
      {categoryTag ? <p className="lane__tag">{categoryTag}</p> : null}
      {dates ? field("lane__dates", <>🗓 {dates}</>) : null}
      {costLabel(option) ? field("lane__cost", costLabel(option)) : null}
      {option.description ? field("lane__notes", option.description) : null}
      {option.url ? (
        <a
          className="lane__link"
          href={option.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          Link ↗
        </a>
      ) : null}
      <p className="lane__by">
        by {option.proposerName}
        {option.materialChangedAt ? " · edited" : ""}
      </p>
      {locked ? (
        <p className="lane__decided">
          ✦ Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
        </p>
      ) : null}
      <VoteDots
        tripId={tripId}
        category={category.id}
        option={option}
        myRole={myRole}
        frozen={frozen}
      />
      {actionError ? (
        <p className="board__form-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </article>
  );
}
