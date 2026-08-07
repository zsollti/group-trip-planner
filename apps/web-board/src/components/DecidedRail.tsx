import { useState, type CSSProperties } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CategoryView, OptionView, TripRole } from "@gtp/types";
import { can } from "@gtp/types";
import { Menu, type MenuItem } from "./Menu";
import { OptionDetail } from "./OptionDetail";
import { useUnlockAction } from "../lib/optionActions";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { isTruncated, truncateName } from "../lib/truncate";

/** A locked option paired with the category it was decided in. */
export interface DecidedItem {
  option: OptionView;
  category: CategoryView;
}

/**
 * One decision, as a chip.
 *
 * Deliberately not an `OptionCard`. A card is a thing you are still deciding
 * about — it carries the vote dots, the edit affordance, the proposer. A
 * decision is settled, so the chip carries only what you re-read afterwards:
 * which question it answers, what won, when, and what it costs. Everything else
 * is one click away in the detail dialog.
 */
function DecidedChip({
  tripId,
  option,
  category,
  myRole,
  frozen,
  dndEnabled,
}: {
  tripId: string;
  option: OptionView;
  category: CategoryView;
  myRole: TripRole;
  frozen: boolean;
  dndEnabled: boolean;
}) {
  const [viewing, setViewing] = useState(false);
  const unlock = useUnlockAction(tripId, category.id, option);
  const { setNodeRef, transform, attributes, listeners, isDragging } =
    useDraggable({
      id: option.id,
      data: { type: "locked", categoryId: category.id },
      disabled: !dndEnabled,
    });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };

  const dates = dateRangeLabel(option.startsAt, option.endsAt);
  const cost = costLabel(option);
  const items: MenuItem[] = [
    { label: "View details", onSelect: () => setViewing(true) },
  ];
  // Dragging a chip out of the rail unlocks it; the menu is the keyboard and
  // touch equivalent, which is why it exists rather than relying on the gesture.
  if (can(myRole, "decision.lock") && !frozen) {
    items.push({
      label: "Unlock",
      onSelect: () => void unlock.run(),
      disabled: unlock.pending,
    });
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={
        "decided__chip" + (isDragging ? " decided__chip--dragging" : "")
      }
    >
      {/* Row one: which question, and what won. */}
      <div className="decided__line">
        {dndEnabled ? (
          <button
            type="button"
            className="decided__grip"
            aria-label={`Drag ${option.title} out of Decided to unlock it`}
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        ) : null}
        <span
          className="decided__cat"
          title={isTruncated(category.name) ? category.name : undefined}
        >
          {truncateName(category.name)}
        </span>
        <button
          type="button"
          className="decided__title"
          title={option.title}
          aria-label={`${option.title} — view details`}
          onClick={() => setViewing(true)}
        >
          {truncateName(option.title)}
        </button>
        <Menu label={`Actions for ${option.title}`} items={items} />
      </div>
      {/* Row two: what it costs, and who called it. A decision without an
          author is a fact that appeared from nowhere. Always rendered, so a
          chip missing a price is still the same height as its neighbours — a
          ragged row is harder to scan than a mostly-empty line. */}
      <div className="decided__line decided__line--meta">
        {dates ? <span>🗓 {dates}</span> : null}
        {cost ? <span className="decided__cost">{cost}</span> : null}
        {option.lockedByName ? (
          <span className="decided__by">{option.lockedByName}</span>
        ) : null}
      </div>
      {unlock.error ? (
        <p className="board__form-error" role="alert">
          {unlock.error}
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

/**
 * Everything the trip has settled on, as a horizontal rail above the lanes.
 *
 * This used to be a lane — same width, same card shape, same everything but a
 * dashed border — sitting first in the row. It read as a sixth category, which
 * is exactly what it is not: the lanes are the open questions, and this is the
 * answers. Pulling it out of the row and laying it flat next to the cost strip
 * makes the top of the board say "here is your trip so far" instead of asking
 * you to parse a column that behaves differently from its neighbours.
 *
 * It remains the drop target for drag-to-decide, and a wide strip is a
 * considerably easier one to hit than a 15rem column that scrolls off-screen the
 * moment a board has more than four lanes.
 */
export function DecidedRail({
  tripId,
  items,
  myRole,
  frozen,
  dndEnabled,
}: {
  tripId: string;
  items: DecidedItem[];
  myRole: TripRole;
  frozen: boolean;
  dndEnabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "decided",
    data: { type: "decided" },
  });

  return (
    <section
      ref={setNodeRef}
      className={"decided" + (isOver ? " decided--drop-active" : "")}
      aria-label="Decided"
    >
      <h2 className="decided__head">
        <span aria-hidden="true">✦ </span>Decided
        {items.length > 0 ? (
          <span className="decided__count">{items.length}</span>
        ) : null}
      </h2>
      <div className="decided__row">
        {items.length === 0 ? (
          <p className="decided__empty">
            {isOver
              ? "Drop to decide"
              : "Nothing settled yet — lock a card, or drag one here."}
          </p>
        ) : (
          items.map(({ option, category }) => (
            <DecidedChip
              key={option.id}
              tripId={tripId}
              option={option}
              category={category}
              myRole={myRole}
              frozen={frozen}
              dndEnabled={dndEnabled}
            />
          ))
        )}
      </div>
    </section>
  );
}
