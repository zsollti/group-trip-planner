import { useState, type CSSProperties, type ReactNode } from "react";
import {
  can,
  canManageOption,
  categoryOptionFields,
  isHttpUrl,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import { ApiError, useLockOption } from "@gtp/api-client";
import { Menu, type MenuItem } from "./Menu";
import { OptionDetail } from "./OptionDetail";
import { VoteDots } from "./optionControls";
import { useUnlockAction } from "../lib/optionActions";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { truncateName } from "../lib/truncate";

/**
 * One option card (Phase 3.5) — the presentational card shared by the category
 * lanes (proposed) and, before the Decided rail replaced it, the Decided column.
 * Content-first: title,
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
  settled = false,
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
  /**
   * Render as the lane's settled answer rather than one of its candidates.
   * Purely presentational — the actions are unchanged, and the vote control
   * stays because voting is advisory and deliberately allowed on a locked
   * option (Phase 2.3): the tally keeps recording what the group thinks, it
   * just no longer decides anything.
   */
  settled?: boolean;
}) {
  const lock = useLockOption(tripId, category.id);
  // Shared with the Decided rail's chip, so "undo this decision" behaves the
  // same wherever a locked option is reachable from.
  const unlock = useUnlockAction(tripId, category.id, option);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  const manageable = canManageOption(myRole, option.proposerId === myUserId);
  const canDecide = can(myRole, "decision.lock") && !frozen;
  const locked = option.status === "LOCKED";
  const dates = dateRangeLabel(
    option.startsAt,
    option.endsAt,
    categoryOptionFields(category).dateGranularity,
  );

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

  const openView = () => setViewing(true);

  const items: MenuItem[] = [];
  items.push({ label: "View details", onSelect: openView });
  if (manageable && !frozen && !locked && onEdit) {
    items.push({ label: "Edit", onSelect: () => onEdit(option) });
  }
  if (canDecide) {
    items.push(
      locked
        ? { label: "Unlock", onSelect: unlock.run, disabled: unlock.pending }
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

  // Click-to-edit / click-to-view (Phase 3.5): the shown parameters open the full
  // form for those who can edit this option (proposer/organizer, not locked/frozen);
  // everyone else (incl. locked cards, whose notes are clamped on the board) opens
  // the read-only detail dialog so the option can still be read in full.
  const editable = Boolean(onEdit) && manageable && !frozen && !locked;
  const openEdit = () => onEdit?.(option);
  const field = (className: string, content: ReactNode) => (
    <button
      type="button"
      className="lane__field-btn"
      title={editable ? "Edit option" : "View details"}
      onClick={editable ? openEdit : openView}
    >
      <span className={className}>{content}</span>
    </button>
  );

  return (
    <article
      ref={cardRef}
      style={style}
      className={
        "lane__card lane__card--option" +
        (settled ? " lane__card--settled" : "") +
        (dragging ? " lane__card--dragging" : "")
      }
    >
      <div className="lane__card-head">
        <strong>
          {/* Shortened for the card, full on `title`/`aria-label` — the detail
              view this opens is where the whole title is shown. */}
          <button
            type="button"
            className="lane__field-btn"
            title={option.title}
            aria-label={`${option.title} — ${editable ? "edit option" : "view details"}`}
            onClick={editable ? openEdit : openView}
          >
            {truncateName(option.title)}
          </button>
        </strong>
        <div className="lane__card-tools">
          {grip}
          {items.length > 0 ? (
            <Menu label={`Actions for ${option.title}`} items={items} />
          ) : null}
        </div>
      </div>
      {dates ? field("lane__dates", <>🗓 {dates}</>) : null}
      {costLabel(option) ? field("lane__cost", costLabel(option)) : null}
      {option.description ? field("lane__notes", option.description) : null}
      {option.url && isHttpUrl(option.url) ? (
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
      {(actionError ?? unlock.error) ? (
        <p className="board__form-error" role="alert">
          {actionError ?? unlock.error}
        </p>
      ) : null}
      {viewing ? (
        <OptionDetail
          category={category}
          option={option}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </article>
  );
}
