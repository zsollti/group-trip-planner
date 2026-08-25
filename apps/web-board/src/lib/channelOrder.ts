import type { ChannelView } from "@gtp/types";

/**
 * What order the chat switcher puts its channels in.
 *
 * Two rules, and the first one always wins:
 *
 *  1. **The trip's own channel leads.** It is the one conversation every member
 *     is in and the one every "where do I say this?" falls back to, so it is a
 *     fixed landmark rather than a competitor — a General chip that drifted to
 *     third place because two categories were busier would make the row
 *     something you have to read instead of something you aim at.
 *  2. **Everything else, most recently spoken in first.** Creation order — what
 *     the server returns — is the one order with nothing to do with where the
 *     talking is: on a board with eight category discussions the live one sat
 *     wherever its lane happened to be added, usually collapsed behind the
 *     "＋N".
 *
 * A channel nobody has written in yet has no `lastMessageAt` and sorts after
 * every channel that does, keeping its incoming (creation) order among its
 * peers — `Array.sort` is stable, so equal keys are left alone.
 *
 * Pure, and deliberately separate from *when* the switcher applies it: the row
 * re-sorts when it opens and when the channel set changes, never while someone
 * is reading it. A chip sliding out from under the cursor because a message
 * arrived somewhere else is worse than an order a few seconds stale.
 */
export function orderChannels(
  channels: readonly ChannelView[],
  generalId: string | undefined,
): ChannelView[] {
  const rank = (c: ChannelView): number =>
    c.lastMessageAt ? -Date.parse(c.lastMessageAt) : Number.POSITIVE_INFINITY;
  return [...channels].sort((a, b) => {
    if (a.id === generalId) return -1;
    if (b.id === generalId) return 1;
    return rank(a) - rank(b);
  });
}

/**
 * `channels` in the order `ids` states, with anything `ids` doesn't mention kept
 * at the end in its own order.
 *
 * The tail is what makes a stale order safe: a channel created live over the
 * socket exists in the list one render before the re-sort runs, and without this
 * it would simply vanish from the row for that render. It also means the caller
 * can hold an order across a set change without ever showing a short row.
 */
export function applyOrder<T extends { id: string }>(
  channels: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const known = ids.flatMap((id) => {
    const found = byId.get(id);
    return found ? [found] : [];
  });
  const seen = new Set(known.map((c) => c.id));
  return [...known, ...channels.filter((c) => !seen.has(c.id))];
}
