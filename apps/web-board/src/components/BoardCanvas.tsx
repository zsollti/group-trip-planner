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
import { sortLanes, useLaneSort, type LaneSort } from "../lib/laneSort";

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
  onOpenChannel,
}: {
  tripId: string;
  categories: CategoryView[];
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  /** Open the chat panel on a category's discussion channel (Phase 4.5). */
  onOpenChannel: (channelId: string) => void;
}) {
  const catIds = categories.map((c) => c.id);
  const opts = useCategoriesOptions(tripId, catIds);
  const [laneSort, setLaneSort] = useLaneSort();
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

  // Display order. Sorting by "still undecided" is a per-user view, so it must
  // not touch the stored positions — and lane drag has to stand down while it is
  // on, since a drag reorders by index and the displayed indices would no longer
  // be the stored ones. Card gestures (lock/unlock, within-lane reorder) are
  // unaffected: they are scoped to a single lane either way.
  const displayCategories = useMemo(
    () => sortLanes(categories, opts.byCategory, laneSort),
    [categories, opts.byCategory, laneSort],
  );
  const laneDragEnabled = dndEnabled && laneSort === "manual";

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const a = active.data.current as DndData | undefined;
    if (!a) return;
    const o = over?.data.current as DndData | undefined;
    const overDecided = over?.id === "decided" || o?.type === "locked";

    if (a.type === "lane") {
      if (!over || o?.type !== "lane" || over.id === active.id) return;
      // Only reachable in manual sort (laneDragEnabled), where the displayed
      // order is the stored order — so these indices are the server's.
      const ids = displayCategories.map((c) => c.id);
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
  const laneIds = displayCategories.map((c) => `lane:${c.id}`);

  return (
    <>
      <CostTally tripId={tripId} />
      <div className="board__lanetools">
        <label className="board__lanesort" htmlFor="lane-sort">
          <span>Sort lanes</span>
          <select
            id="lane-sort"
            className="board__select"
            value={laneSort}
            onChange={(e) => setLaneSort(e.target.value as LaneSort)}
          >
            <option value="manual">Manual order</option>
            <option value="undecided">Undecided first</option>
          </select>
        </label>
        {laneSort === "undecided" && dndEnabled ? (
          <p className="board__muted" role="status">
            Drag to reorder lanes is off while sorting — switch to manual order
            to rearrange them.
          </p>
        ) : null}
      </div>
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
            {displayCategories.map((category) => (
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
                laneDragEnabled={laneDragEnabled}
                onOpenChannel={onOpenChannel}
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
