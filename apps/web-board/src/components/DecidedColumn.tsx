import type { CSSProperties } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CategoryView, OptionView, TripRole } from "@gtp/types";
import { OptionCard } from "./OptionCard";

/** A locked option paired with the category it was decided in. */
export interface DecidedItem {
  option: OptionView;
  category: CategoryView;
}

/**
 * A locked card in the Decided column, draggable back out to unlock (Phase 3.5).
 * The grip carries the drag listeners; dropping anywhere outside Decided triggers
 * the unlock (the Unlock button remains the non-drag path).
 */
function DraggableLockedCard({
  tripId,
  option,
  category,
  myRole,
  myUserId,
  frozen,
  dndEnabled,
}: {
  tripId: string;
  option: OptionView;
  category: CategoryView;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  dndEnabled: boolean;
}) {
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
  const grip = dndEnabled ? (
    <button
      type="button"
      className="lane__grip"
      aria-label={`Drag ${option.title} out of Decided to unlock it`}
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
      cardRef={setNodeRef}
      style={style}
      grip={grip}
      dragging={isDragging}
      categoryTag={category.name}
    />
  );
}

/**
 * The global "Decided" column (Phase 3.5) — every locked pick across all
 * categories, à la a board's "Done" column, and the drop target for the
 * drag-to-Decided gesture. Each card is tagged with its category (the column is
 * cross-category) and carries the Unlock control. Locked picks feed the committed
 * cost total.
 */
export function DecidedColumn({
  tripId,
  items,
  myRole,
  myUserId,
  frozen,
  dndEnabled,
}: {
  tripId: string;
  items: DecidedItem[];
  myRole: TripRole;
  myUserId: string | undefined;
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
      className={"lane lane--decided" + (isOver ? " lane--drop-active" : "")}
      aria-label="Decided"
    >
      <h2 className="lane__title">✦ Decided</h2>
      {items.length === 0 ? (
        <div className="lane__card lane__card--ghost">
          {isOver ? "Drop to decide" : "Locked picks land here"}
        </div>
      ) : (
        items.map(({ option, category }) => (
          <DraggableLockedCard
            key={option.id}
            tripId={tripId}
            option={option}
            category={category}
            myRole={myRole}
            myUserId={myUserId}
            frozen={frozen}
            dndEnabled={dndEnabled}
          />
        ))
      )}
    </section>
  );
}
