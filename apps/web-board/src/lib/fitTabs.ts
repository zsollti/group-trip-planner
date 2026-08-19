import { useLayoutEffect, useState } from "react";

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
 *
 * A non-empty row always shows **at least one** item, whatever count it is
 * handed. {@link fitCount} already promises that of its own answer, but this
 * takes a number from a caller, and a zero arriving here — a count measured
 * before anything had mounted — produced a row that was nothing but the "＋N":
 * a switcher advertising four channels and offering none.
 */
export function partitionByFit<T>(
  items: readonly T[],
  visibleCount: number,
  isActive: (item: T) => boolean,
): { shown: T[]; hidden: T[] } {
  if (visibleCount >= items.length) return { shown: [...items], hidden: [] };

  const shown = items.slice(0, Math.max(1, visibleCount));
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
 *
 * **The refs are callbacks, and that is the whole correctness argument.** They
 * were `useRef` objects read by an effect keyed on the item count, which never
 * fires when a node *mounts* — and the row this measures lives inside a panel
 * that is closed on first render. So the effect ran once with both refs still
 * null, measured nothing, and the count stayed at whatever the item count had
 * been at mount: zero, before any channel had arrived over the socket. Opening
 * the chat then collapsed **every** chip behind the "＋N", which is exactly
 * what the switcher looked like in use. A callback ref is state, so mounting the
 * row re-runs the effect and the measurement happens when there is something to
 * measure.
 *
 * Unmeasured is `null` rather than a number, so "we have not looked yet" cannot
 * be mistaken for "nothing fits" — it reads as the plain row, the same graceful
 * default {@link fitCount} gives a container of unknown width.
 */
export function useFitCount(
  itemCount: number,
  reserveWidth: number,
  gap: number,
): {
  containerRef: React.RefCallback<HTMLDivElement>;
  measureRef: React.RefCallback<HTMLDivElement>;
  visibleCount: number;
} {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState<HTMLDivElement | null>(null);
  const [fitted, setFitted] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!container || !measure) return;
    const recompute = () => {
      const widths = Array.from(measure.children).map(
        (child) => (child as HTMLElement).offsetWidth,
      );
      setFitted(fitCount(widths, container.clientWidth, reserveWidth, gap));
    };
    recompute();
    // Not available in jsdom; without it the row simply keeps its first answer.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    // The container catches a resized panel; the measure row catches the item
    // list itself changing width (a rename, a new channel).
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [container, measure, reserveWidth, gap, itemCount]);

  return {
    containerRef: setContainer,
    measureRef: setMeasure,
    visibleCount: fitted ?? itemCount,
  };
}
