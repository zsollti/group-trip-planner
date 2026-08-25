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
 * `reserveRef` goes on a hidden copy of the overflow trigger, so the space held
 * back for it is **measured rather than guessed**. It used to be a constant, and
 * the constant was wrong by about half a chip: it was sized for the widest the
 * trigger ever gets (a two-digit count plus an unread badge) and then charged
 * for that on every row, including the ones where the trigger reads "＋2" and
 * carries nothing. Over-reserving does not look like over-reserving — it looks
 * like a chip that plainly had room refusing to appear, with the empty space
 * still sitting there beside the trigger. Same argument for the gap, which
 * {@link cssGap} now reads off the row instead of taking on trust.
 *
 * The fallbacks stand in only where there is nothing to measure: before the
 * trigger exists (a row where everything fits), and in jsdom.
 *
 * Unmeasured is `null` rather than a number, so "we have not looked yet" cannot
 * be mistaken for "nothing fits" — it reads as the plain row, the same graceful
 * default {@link fitCount} gives a container of unknown width.
 */
export function useFitCount(
  itemCount: number,
  fallbackReserve: number,
  fallbackGap: number,
): {
  containerRef: React.RefCallback<HTMLDivElement>;
  measureRef: React.RefCallback<HTMLDivElement>;
  reserveRef: React.RefCallback<HTMLElement>;
  visibleCount: number;
} {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState<HTMLDivElement | null>(null);
  const [reserve, setReserve] = useState<HTMLElement | null>(null);
  const [fitted, setFitted] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!container || !measure) return;
    const recompute = () => {
      const widths = Array.from(measure.children).map(
        (child) => (child as HTMLElement).offsetWidth,
      );
      setFitted(
        fitCount(
          widths,
          container.clientWidth,
          reserve ? reserve.offsetWidth : fallbackReserve,
          cssGap(measure, fallbackGap),
        ),
      );
    };
    recompute();
    // Not available in jsdom; without it the row simply keeps its first answer.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    // The container catches a resized panel; the measure row catches the item
    // list itself changing width (a rename, a new channel); the trigger catches
    // its own label growing ("＋9" to "＋10", a badge appearing).
    observer.observe(container);
    observer.observe(measure);
    if (reserve) observer.observe(reserve);
    return () => observer.disconnect();
  }, [container, measure, reserve, fallbackReserve, fallbackGap, itemCount]);

  return {
    containerRef: setContainer,
    measureRef: setMeasure,
    reserveRef: setReserve,
    visibleCount: fitted ?? itemCount,
  };
}

/**
 * The row's real flex gap, in pixels, or `fallback` when the browser will not
 * say (jsdom computes no styles, and `gap` set through the shorthand does not
 * always resolve). Read rather than passed so the arithmetic cannot drift from
 * the stylesheet: the constant and the CSS were 5px and 0.3rem, which is the
 * kind of difference that only shows up as one missing chip.
 */
function cssGap(el: HTMLElement, fallback: number): number {
  const raw = Number.parseFloat(getComputedStyle(el).columnGap);
  return Number.isFinite(raw) ? raw : fallback;
}
