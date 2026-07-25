import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  can,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import {
  useBoardLock,
  useBoardReorderOptions,
  useBoardUnlock,
  useCategoriesOptions,
  useReorderCategories,
} from "@gtp/api-client";
import { AddCategoryLane } from "./AddCategoryLane";
import { CategoryLane } from "./CategoryLane";
import { CostTally } from "./CostTally";
import { DecidedColumn, type DecidedItem } from "./DecidedColumn";

/** What a draggable/droppable carries so the drop handler can branch (Phase 3.5). */
interface DndData {
  type: "lane" | "card" | "locked" | "decided";
  categoryId?: string;
}

/**
 * The board canvas (Phase 3.5). Lifts every category's options to one place so it
 * can split them into **proposed** cards (in each lane) and **locked** cards (the
 * global "Decided" column), then lays them out as a horizontal, scroll-snapping
 * board with a pinned cost tally.
 *
 * It owns the single `DndContext` for the whole board (organizers, active trip
 * only). Three gestures, all reusing existing endpoints — no new server action:
 *  - drag a card onto Decided → **lock**; drag a locked card out → **unlock**;
 *  - drag a card within its lane → **reorder options** (same category only);
 *  - drag a lane by its header grip → **reorder categories**.
 *
 * The target category is only known at drop time, so the mutations are the
 * trip-scoped `useBoard*` hooks that take the category in their variables. Every
 * gesture also has a button equivalent (lock/unlock, ↑↓ n/a — reorder is
 * drag-only) so keyboard/mobile users are never blocked; drag is enhancement.
 */
export function BoardCanvas({
  tripId,
  categories,
  defaultCurrency,
  myRole,
  myUserId,
  frozen,
}: {
  tripId: string;
  categories: CategoryView[];
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
}) {
  const catIds = categories.map((c) => c.id);
  const opts = useCategoriesOptions(tripId, catIds);
  const reorderCats = useReorderCategories(tripId);
  const boardLock = useBoardLock(tripId);
  const boardUnlock = useBoardUnlock(tripId);
  const boardReorder = useBoardReorderOptions(tripId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const optionById = useMemo(() => {
    const m = new Map<string, OptionView>();
    for (const list of Object.values(opts.byCategory))
      for (const o of list) m.set(o.id, o);
    return m;
  }, [opts.byCategory]);
  const categoryById = useMemo(() => {
    const m = new Map<string, CategoryView>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  // Proposed (non-locked) cards per category, ordered by approval: most-voted
  // first, so casting a vote floats an option up its lane (Phase 3.5 feedback).
  // The server list is position-ordered (a category's manual drag order) and
  // Array.sort is stable, so equal-vote cards keep that order — within-lane drag
  // stays meaningful as the tiebreak. Both the lane render and the drag-reorder
  // index math read this, so the displayed order and the reorder are consistent.
  const proposedByCategory = useMemo(() => {
    const m: Record<string, OptionView[]> = {};
    for (const c of categories) {
      const live = (opts.byCategory[c.id] ?? []).filter(
        (o) => o.status !== "LOCKED",
      );
      m[c.id] = [...live].sort((a, b) => b.voteCount - a.voteCount);
    }
    return m;
  }, [categories, opts.byCategory]);

  const dndEnabled = can(myRole, "decision.lock") && !frozen;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const a = active.data.current as DndData | undefined;
    if (!a) return;
    const o = over?.data.current as DndData | undefined;
    const overDecided = over?.id === "decided" || o?.type === "locked";

    if (a.type === "lane") {
      if (!over || o?.type !== "lane" || over.id === active.id) return;
      const ids = categories.map((c) => c.id);
      const from = ids.indexOf(a.categoryId ?? "");
      const to = ids.indexOf(o.categoryId ?? "");
      if (from < 0 || to < 0 || from === to) return;
      reorderCats.mutate({ orderedIds: arrayMove(ids, from, to) });
      return;
    }

    if (a.type === "card") {
      const cat = categoryById.get(a.categoryId ?? "");
      const opt = optionById.get(String(active.id));
      if (!cat || !opt) return;
      if (overDecided) {
        boardLock.mutate({
          categoryId: cat.id,
          optionId: opt.id,
          optionVersion: opt.version,
          categoryVersion: cat.version,
        });
        return;
      }
      // Reorder within the same lane only (no cross-category moves).
      if (o?.type === "card" && o.categoryId === a.categoryId && over) {
        const ids = (proposedByCategory[cat.id] ?? []).map((x) => x.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0 || from === to) return;
        boardReorder.mutate({
          categoryId: cat.id,
          orderedIds: arrayMove(ids, from, to),
        });
      }
      return;
    }

    if (a.type === "locked") {
      if (overDecided) return; // dropped back in Decided — no-op
      const cat = categoryById.get(a.categoryId ?? "");
      const opt = optionById.get(String(active.id));
      if (!cat || !opt) return;
      boardUnlock.mutate({
        categoryId: cat.id,
        optionId: opt.id,
        version: opt.version,
      });
    }
  }

  if (opts.isPending) {
    return <p className="board__muted">Loading cards…</p>;
  }
  if (opts.isError) {
    return (
      <p className="board__form-error" role="alert">
        Couldn't load the cards. Reload the page to try again.
      </p>
    );
  }

  const decided: DecidedItem[] = [];
  for (const category of categories) {
    for (const option of opts.byCategory[category.id] ?? []) {
      if (option.status === "LOCKED") decided.push({ option, category });
    }
  }
  const laneIds = categories.map((c) => `lane:${c.id}`);

  return (
    <>
      <CostTally tripId={tripId} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="board__canvas" aria-label="Category lanes">
          {/* Decided is pinned first and is never part of the sortable set. */}
          <DecidedColumn
            tripId={tripId}
            items={decided}
            myRole={myRole}
            myUserId={myUserId}
            frozen={frozen}
            dndEnabled={dndEnabled}
          />
          <SortableContext
            items={laneIds}
            strategy={horizontalListSortingStrategy}
          >
            {categories.map((category) => (
              <CategoryLane
                key={category.id}
                tripId={tripId}
                category={category}
                options={proposedByCategory[category.id] ?? []}
                defaultCurrency={defaultCurrency}
                myRole={myRole}
                myUserId={myUserId}
                frozen={frozen}
                dndEnabled={dndEnabled}
              />
            ))}
          </SortableContext>
          {can(myRole, "category.manage") && !frozen ? (
            <AddCategoryLane tripId={tripId} />
          ) : null}
        </div>
      </DndContext>
    </>
  );
}
