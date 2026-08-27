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
  useBoardUnlock,
  useBoardReorderOptions,
  useCategoriesOptions,
  useReorderCategories,
} from "@gtp/api-client";
import { AddCategoryLane } from "./AddCategoryLane";
import { PersonalLane } from "./PersonalLane";
import { CategoryLane } from "./CategoryLane";
import { categoryHueStyleById } from "../lib/categoryTheme";
import { costLabel } from "./optionFormat";
import { applyOrder } from "../lib/pendingOrder";
import { truncateName } from "../lib/truncate";
import { t } from "../lib/i18n";

/** What a draggable/droppable carries so the drop handler can branch (Phase 3.5). */
interface DndData {
  /**
   * `card` and `locked` are both option cards and are told apart here rather
   * than by looking the option up, because the two drags have nothing in
   * common: a candidate sorts among its neighbours and may be locked, a
   * decision does neither and may only be reopened. One type with a status
   * check would make every branch below ask the same question twice.
   */
  type: "lane" | "card" | "locked" | "decide" | "unlock";
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
  // over one of the strips is inside two targets at once. A strip is the
  // specific one and it only exists while it is wanted, so it wins outright
  // rather than relying on whose centre happens to be nearer.
  const strips = hits.filter((h) => /^(decide|unlock):/.test(String(h.id)));
  return strips.length > 0 ? strips : hits;
};

/**
 * The board canvas (Phase 3.5). Lifts every category's options to one place so it
 * can split them into **proposed** and **locked** cards, then lays them out as a
 * horizontal, scroll-snapping row of lanes.
 *
 * **The lanes and nothing else.** It used to render the reference rail beside
 * them too. The rail outlived that arrangement: Plan and Timeline are two views
 * of one trip and the rail belongs to both, so it moved up to the route
 * ({@link BoardRail}) and this became one of two things that can fill the space
 * next to it.
 *
 * It owns the single `DndContext` for the whole board (organizers, active trip
 * only). Four gestures, all reusing existing endpoints — no new server action:
 *  - drag a card onto its lane's lock strip → **lock**;
 *  - drag a settled card onto its lane's unlock strip → **unlock**;
 *  - drag a card within its lane → **reorder options** (same category only);
 *  - drag a lane by its header grip → **reorder categories**.
 *
 * **Unlock is a drag again.** It was "drag a chip out of the Decided rail", and
 * it went when the rail did, leaving a settled card's "⋯" as the only way to
 * reopen a decision — a card that could be locked with the mouse and unlocked
 * only from a menu. The gesture is back inside the lane the card is already in,
 * with a strip of its own that appears for the length of that drag, and the
 * menu item stays exactly where it was.
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
}) {
  const catIds = categories.map((c) => c.id);
  const opts = useCategoriesOptions(tripId, catIds);
  const reorderCats = useReorderCategories(tripId);
  const boardLock = useBoardLock(tripId);
  const boardUnlock = useBoardUnlock(tripId);
  const boardReorder = useBoardReorderOptions(tripId);

  /**
   * The order a drop just made, until the server's own list arrives.
   *
   * Neither reorder wrote anything before its response came back, so releasing
   * a card put every neighbour back where it started, and the answer slid in
   * over the top a round trip later: one gesture, animated twice. dnd-kit
   * absorbs a reorder made in the same commit as the drop and nothing else, and
   * a mutation's `onMutate` is a render too late for that. So the board holds
   * the answer itself for the length of the request — see `lib/pendingOrder`.
   */
  const [laneOrder, setLaneOrder] = useState<string[] | null>(null);
  const [cardOrder, setCardOrder] = useState<{
    categoryId: string;
    ids: string[];
  } | null>(null);

  /** The lanes as the reader last left them, which is what everything below
   *  renders and what the drop's index arithmetic must agree with. */
  const lanes = useMemo(
    () => applyOrder(categories, laneOrder, (c) => c.id),
    [categories, laneOrder],
  );

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
      const ranked = [...live].sort((a, b) => b.voteCount - a.voteCount);
      // A lane the reader has just rearranged shows their arrangement while the
      // request that saves it is in flight; every other lane is untouched.
      m[c.id] =
        cardOrder?.categoryId === c.id
          ? applyOrder(ranked, cardOrder.ids, (o) => o.id)
          : ranked;
    }
    return m;
  }, [categories, opts.byCategory, cardOrder]);

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
    if (a?.type === "card" || a?.type === "locked") {
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
      const ids = lanes.map((c) => c.id);
      const from = ids.indexOf(a.categoryId ?? "");
      const to = ids.indexOf(o.categoryId ?? "");
      if (from < 0 || to < 0 || from === to) return;
      const orderedIds = arrayMove(ids, from, to);
      // Held first, sent second: the row has to be in its new order in this
      // same commit, or the lanes spring back and slide again when the answer
      // lands. Cleared when the request settles — the list underneath is then
      // the server's, whether it accepted the drop or refused it.
      setLaneOrder(orderedIds);
      reorderCats.mutate(
        { orderedIds },
        { onSettled: () => setLaneOrder(null) },
      );
      return;
    }

    if (a.type === "locked") {
      const cat = categoryById.get(a.categoryId ?? "");
      const opt = optionById.get(String(active.id));
      if (!cat || !opt) return;
      // The unlock strip is the only target this drag has. Dropped anywhere
      // else — including on a candidate, which would otherwise read as a
      // reorder — the card goes back and nothing is written.
      if (o?.type !== "unlock") return;
      boardUnlock.mutate({
        categoryId: cat.id,
        optionId: opt.id,
        version: opt.version,
      });
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
        const orderedIds = arrayMove(ids, from, to);
        setCardOrder({ categoryId: cat.id, ids: orderedIds });
        boardReorder.mutate(
          { categoryId: cat.id, orderedIds },
          { onSettled: () => setCardOrder(null) },
        );
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

  const laneIds = lanes.map((c) => `lane:${c.id}`);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerFirst}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="board__canvas" aria-label={t("Category lanes")}>
          <SortableContext
            items={laneIds}
            strategy={horizontalListSortingStrategy}
          >
            {lanes.map((category) => (
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
                decideTarget={
                  dragging?.categoryId === category.id &&
                  dragging.status !== "LOCKED"
                }
                unlockTarget={
                  dragging?.categoryId === category.id &&
                  dragging.status === "LOCKED"
                }
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
          {/*
           * Last, and outside the `SortableContext` above.
           *
           * Outside because it is not one of the trip's lanes and cannot be
           * reordered among them — there is one of these and it is always the
           * reader's, so there is nothing for a drag to express. It sits after
           * "add a lane" for the same reason: everything to the left of it is
           * the board the trip shares, and this is the one column that is not.
           *
           * It renders inside the DndContext only because it is inside the
           * canvas; it registers no droppable and no sortable, so a card
           * dragged over it finds nothing and goes back, which is the right
           * answer — a decision cannot be dropped into a private column.
           *
           * **No role gate.** Every member keeps a list, Guests included; the
           * capability row says so and the column follows it rather than
           * re-deciding here.
           */}
          <PersonalLane
            tripId={tripId}
            myUserId={myUserId}
            categories={categories}
            defaultCurrency={defaultCurrency}
            frozen={frozen}
            tripDates={tripDates}
          />
        </div>
        {/* Deliberately a plain preview and not an `OptionCard`: the card in
            hand is not interactive, and mounting a second copy of one would
            duplicate its mutations and its dialog. */}
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <article
              className={
                "lane__card lane__card--option lane__card--dragging" +
                (dragging.status === "LOCKED" ? " lane__card--settled" : "")
              }
              // The preview is portalled out of the lane, so there is no
              // hue to inherit — and a settled card drawn without one paints
              // the fallback colour rather than the lane's.
              style={categoryHueStyleById(dragging.categoryId, categories)}
            >
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
