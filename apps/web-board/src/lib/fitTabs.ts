import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * How many of a row's items fit before the rest must collapse behind an overflow
 * trigger. Behind the chat channel switcher, which used to be a horizontally
 * scrolling strip — with a channel per category, the tail of the list ended up
 * off-screen behind a scrollbar nobody thinks to drag.
 *
 * The arithmetic is a pure function so it can be tested (jsdom does no layout,
 * so anything that *measures* can't be); {@link useFitCount} is the thin part
 * that feeds it real widths and re-runs on resize.
 */

/**
 * How many leading items of `itemWidths` fit in `containerWidth`.
 *
 * When everything fits, no trigger is needed and every item is shown. Otherwise
 * `reserveWidth` (the overflow trigger) is subtracted first, because collapsing
 * items only helps if there is room left to reach them. `gap` is the flex gap
 * between items, counted between neighbours and once more before the trigger.
 *
 * Never returns 0 for a non-empty row: one clipped chip is more useful than a row
 * that is nothing but a "＋N" button. With no layout information at all (a width
 * of 0, as in jsdom) everything "fits" — the graceful default is the plain row.
 */
export function fitCount(
  itemWidths: readonly number[],
  containerWidth: number,
  reserveWidth: number,
  gap = 0,
): number {
  if (itemWidths.length === 0) return 0;

  const total =
    itemWidths.reduce((sum, w) => sum + w, 0) + gap * (itemWidths.length - 1);
  if (total <= containerWidth) return itemWidths.length;

  const available = containerWidth - reserveWidth - gap;
  let used = 0;
  let fitted = 0;
  for (const width of itemWidths) {
    const next = used + (fitted === 0 ? 0 : gap) + width;
    if (next > available) break;
    used = next;
    fitted++;
  }
  return Math.max(1, fitted);
}

/**
 * Split `items` into the ones the row shows and the ones that collapse behind the
 * overflow trigger, given how many fit.
 *
 * The active item is **always** shown: it takes the last visible slot when it
 * would otherwise have been collapsed, displacing whatever sat there. Without
 * that, opening a channel far down the list left the row advertising every
 * channel except the one being read.
 */
export function partitionByFit<T>(
  items: readonly T[],
  visibleCount: number,
  isActive: (item: T) => boolean,
): { shown: T[]; hidden: T[] } {
  if (visibleCount >= items.length) return { shown: [...items], hidden: [] };

  const shown = items.slice(0, Math.max(0, visibleCount));
  const active = items.find(isActive);
  if (active !== undefined && !shown.includes(active) && shown.length > 0) {
    shown[shown.length - 1] = active;
  }
  return { shown, hidden: items.filter((item) => !shown.includes(item)) };
}

/**
 * Measure a row of items and report how many fit ({@link fitCount}).
 *
 * `measureRef` goes on an `aria-hidden` copy of the **full** item list, laid out
 * off-flow: measuring the real row cannot work, because the moment an item is
 * collapsed it stops contributing a width and the answer oscillates. The hidden
 * copy always holds every item, so the measurement is stable and survives a
 * rename, a font load, or a channel appearing live over the socket.
 */
export function useFitCount(
  itemCount: number,
  reserveWidth: number,
  gap: number,
): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  measureRef: React.RefObject<HTMLDivElement | null>;
  visibleCount: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(itemCount);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const widths = Array.from(measure.children).map(
      (child) => (child as HTMLElement).offsetWidth,
    );
    setVisibleCount(
      fitCount(widths, container.clientWidth, reserveWidth, gap),
    );
  }, [reserveWidth, gap]);

  useLayoutEffect(() => {
    recompute();
    // Not available in jsdom; without it the row simply keeps its first answer.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    // The container catches a resized panel; the measure row catches the item
    // list itself changing width (a rename, a new channel).
    if (containerRef.current) observer.observe(containerRef.current);
    if (measureRef.current) observer.observe(measureRef.current);
    return () => observer.disconnect();
  }, [recompute, itemCount]);

  return { containerRef, measureRef, visibleCount };
}
