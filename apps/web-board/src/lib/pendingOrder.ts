/**
 * The order a drop just made, held in front of the server's until it agrees.
 *
 * **Why a drag needs this at all.** Both board reorders — lanes, and cards
 * within a lane — wrote nothing until the response came back: the mutation set
 * the new list in `onSuccess` and there was no optimistic step. dnd-kit,
 * meanwhile, drops the transforms it was displacing the neighbours with the
 * instant the pointer is released. So the drop produced a render in which
 * everything was back where it started, the request flew, and a beat later the
 * new list arrived and every card slid to its new place a second time. That is
 * the "why does everything jump back and then move again" — one gesture,
 * animated twice, with a round trip in between.
 *
 * dnd-kit's own answer is to reorder the list **in the same commit** as the
 * drop, which it can then absorb without a visible shift. React Query cannot do
 * that: `onMutate` is reached through at least one microtask, which is a render
 * too late. So the board keeps the answer locally for the length of the request
 * and drops it when the server's own list lands — this module is that hold.
 *
 * It is not a cache and never rolls anything back by hand: a refused reorder
 * simply clears the hold, and what is underneath is the server's order, which is
 * the truth the tiles should snap to.
 */

/**
 * `items` in the order `order` names, or untouched when there is no hold.
 *
 * Anything `order` does not mention keeps its relative position and goes last —
 * an option proposed by someone else while the request was in flight, most
 * likely. It is one round trip out of place and then correct, which is a better
 * failure than dropping it from the lane.
 */
export function applyOrder<T>(
  items: readonly T[],
  order: readonly string[] | null,
  keyOf: (item: T) => string,
): T[] {
  if (!order) return [...items];
  const rank = new Map(order.map((id, i) => [id, i]));
  // Stable, so the unranked tail keeps the order the server gave it.
  return [...items].sort(
    (a, b) =>
      (rank.get(keyOf(a)) ?? Number.POSITIVE_INFINITY) -
      (rank.get(keyOf(b)) ?? Number.POSITIVE_INFINITY),
  );
}
