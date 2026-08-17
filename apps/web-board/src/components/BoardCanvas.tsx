import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
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
  type TripDateRange,
  type TripRole,
} from "@gtp/types";
import {
  useBoardLock,
  useBoardReorderOptions,
  useCategoriesOptions,
  useReorderCategories,
} from "@gtp/api-client";
import { AddCategoryLane } from "./AddCategoryLane";
import { CategoryLane } from "./CategoryLane";
import { CostTally } from "./CostTally";
import { CrewPanel } from "./CrewPanel";
import { costLabel } from "./optionFormat";
import { truncateName } from "../lib/truncate";
import { t } from "../lib/i18n";

/** What a draggable/droppable carries so the drop handler can branch (Phase 3.5). */
interface DndData {
  type: "lane" | "card" | "decide";
  categoryId?: string;
}

/**
 * Whatever is under the pointer, falling back to nearest-corner.
 *
 * `closestCorners` alone compares the dragged item's corners to every
 * droppable's, which is fine when every droppable is the same shape and not fine
 * when they are not — a card lifted over a wide target can still have some
 * lane's corner nearer to it than the thing it is visibly inside. Asking "what
 * is the pointer actually over?" first is what dnd-kit documents for mixed-size
 * droppables; corners still decide the within-lane reorder, where the pointer is
 * often between two cards and over neither.
 */
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return closestCorners(args);
  // A lane is itself a droppable (it sorts among the other lanes), so a pointer
  // over the decide strip is inside two targets at once. The strip is the
  // specific one and it only exists while it is wanted, so it wins outright
  // rather than relying on whose centre happens to be nearer.
  const decide = hits.filter((h) => String(h.id).startsWith("decide:"));
  return decide.length > 0 ? decide : hits;
};

/**
 * The board canvas (Phase 3.5). Lifts every category's options to one place so it
 * can split them into **proposed** and **locked** cards, then lays them out as a
 * horizontal, scroll-snapping row of lanes beside the reference rail (what the
 * trip costs, and who is on it).
 *
 * It owns the single `DndContext` for the whole board (organizers, active trip
 * only). Three gestures, all reusing existing endpoints — no new server action:
 *  - drag a card onto its lane's decide strip → **lock**;
 *  - drag a card within its lane → **reorder options** (same category only);
 *  - drag a lane by its header grip → **reorder categories**.
 *
 * **Unlock is no longer a drag.** It was "drag a chip out of the Decided rail",
 * and the rail is gone; a settled card's "⋯" menu now carries it alone. That is
 * the same menu it always offered, so nothing became unreachable — the board
 * simply stopped having two ways to do it.
 *
 * **The lanes are in one order: the stored one.** A per-browser "sort by
 * undecided first" view used to sit above the row, and it cost more than it
 * paid for. It could not touch `position` (one reader's view is not the trip's
 * order), so while it was on the displayed order and the stored order
 * disagreed, and lane drag had to be switched off to stop a drag writing the
 * wrong indices — a board that quietly refused a gesture, with a line of prose
 * explaining why. Dragging a lane where you want it is the better answer to
 * "these are in the wrong order", and it is the one that persists for everyone.
 *
 * The target category is only known at drop time, so the mutations are the
 * trip-scoped `useBoard*` hooks that take the category in their variables. Every
 * gesture has a button equivalent (lock/unlock on the card menu; reorder is
 * drag-only) so keyboard and touch users are never blocked — drag is
 * enhancement.
 */
export function BoardCanvas({
  tripId,
  categories,
  defaultCurrency,
  myRole,
  myUserId,
  frozen,
  tripDates,
  onOpenChannel,
  onManageMembers,
  onInviteMembers,
}: {
  tripId: string;
  categories: CategoryView[];
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen: boolean;
  /**
   * The trip's settled range, or null while it is still an open question.
   *
   * Passed down rather than computed per card: once the trip has dates, an
   * option's own dates mean "when within the trip", and a card that falls
   * entirely outside says so (`isOutsideTripDates`).
   */
  tripDates: TripDateRange | null;
  /** Open the chat panel on a category's discussion channel (Phase 4.5). */
  onOpenChannel: (channelId: string) => void;
  /** Open the members dialog from the crew panel — the route owns it, so the
   *  board's "⋯" menu and the panel can never open two copies of it. */
  onManageMembers: () => void;
  /** Open the invite dialog from the crew panel, owned by the route for the
   *  same reason. */
  onInviteMembers: () => void;
}) {
  const catIds = categories.map((c) => c.id);
  const opts = useCategoriesOptions(tripId, catIds);
  const reorderCats = useReorderCategories(tripId);
  const boardLock = useBoardLock(tripId);
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

  // Locked options per category, pinned at the top of their own lane where they
  // are the answer to that lane's question. They used to appear in the Decided
  // rail as well; that second copy is what the rail turned out to be.
  const decidedByCategory = useMemo(() => {
    const m: Record<string, OptionView[]> = {};
    for (const c of categories) {
      m[c.id] = (opts.byCategory[c.id] ?? []).filter(
        (o) => o.status === "LOCKED",
      );
    }
    return m;
  }, [categories, opts.byCategory]);

  const dndEnabled = can(myRole, "decision.lock") && !frozen;

  /**
   * The card currently in hand, so {@link DragOverlay} can show it.
   *
   * The overlay was load-bearing when the drop target was the Decided rail:
   * `.board__canvas` scrolls horizontally, a box that scrolls on one axis clips
   * on **both**, and a card dragged up out of the lane row was cut off at the
   * canvas edge and simply vanished while dnd-kit auto-scrolled the row. The
   * target is inside the lane now, so nothing has to leave the container and
   * that failure can no longer happen.
   *
   * Kept anyway. It renders in dnd-kit's own layer above everything, which keeps
   * the card in hand whole and above its neighbours near a lane's edges, and
   * removing it would be a change to how every drag feels in exchange for
   * nothing.
   */
  const [dragging, setDragging] = useState<OptionView | null>(null);

  function handleDragStart(e: DragStartEvent) {
    const a = e.active.data.current as DndData | undefined;
    if (a?.type === "card") {
      setDragging(optionById.get(String(e.active.id)) ?? null);
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    const a = active.data.current as DndData | undefined;
    if (!a) return;
    const o = over?.data.current as DndData | undefined;

    if (a.type === "lane") {
      if (!over || o?.type !== "lane" || over.id === active.id) return;
      // The displayed order is the stored order, so these indices are the
      // server's. That used not to hold: a "sort by undecided" view reordered
      // the row without touching `position`, so a drag in that view would have
      // written the indices the reader saw rather than the ones the server
      // keeps. The view is gone and with it the discrepancy.
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
      // Dropped on the lane's decide strip — which only exists for the lane the
      // card is already in, so there is no cross-category move to guard against.
      if (o?.type === "decide") {
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
    }
  }

  if (opts.isPending) {
    return <p className="board__muted">{t("Loading cards…")}</p>;
  }
  if (opts.isError) {
    return (
      <p className="board__form-error" role="alert">
        {t("Couldn't load the cards. Reload the page to try again.")}
      </p>
    );
  }

  const laneIds = categories.map((c) => `lane:${c.id}`);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerFirst}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="board__layout">
          {/* What this trip costs, and who is on it — the two things the lanes
            beside them cannot tell you by being read. The Decided rail used to
            sit here and it was the third copy of every decision; the lane that
            answered the question already pins its answer at the top.

            A column rather than a band across the top: both are reference
            material you consult *while* working the lanes, and a band pushed
            the lanes themselves below the fold on a laptop. */}
          <aside className="board__rail">
            <CostTally tripId={tripId} />
            <CrewPanel
              tripId={tripId}
              myRole={myRole}
              myUserId={myUserId}
              onManage={onManageMembers}
              onInvite={onInviteMembers}
            />
          </aside>
          <div className="board__canvas" aria-label={t("Category lanes")}>
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
                  decided={decidedByCategory[category.id] ?? []}
                  defaultCurrency={defaultCurrency}
                  myRole={myRole}
                  myUserId={myUserId}
                  frozen={frozen}
                  tripDates={tripDates}
                  dndEnabled={dndEnabled}
                  // Only the lane the card came from offers to decide it: the
                  // lock endpoint is category-scoped and a card cannot change
                  // lanes, so any other lane's target would be a promise the
                  // board could not keep.
                  decideTarget={dragging?.categoryId === category.id}
                  onOpenChannel={onOpenChannel}
                />
              ))}
            </SortableContext>
            {can(myRole, "category.manage") && !frozen ? (
              <AddCategoryLane
                tripId={tripId}
                categoryCount={categories.length}
              />
            ) : null}
          </div>
        </div>
        {/* Deliberately a plain preview and not an `OptionCard`: the card in
            hand is not interactive, and mounting a second copy of one would
            duplicate its mutations and its dialog. */}
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <article className="lane__card lane__card--option lane__card--dragging">
              <div className="lane__card-head">
                <strong>{truncateName(dragging.title)}</strong>
              </div>
              {costLabel(dragging) ? (
                <span className="lane__cost">{costLabel(dragging)}</span>
              ) : null}
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
