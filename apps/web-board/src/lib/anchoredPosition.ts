/**
 * Where a popover goes when it hangs off a trigger.
 *
 * The arithmetic only, with no DOM in it, for the reason every other geometry
 * module here gives: jsdom does no layout, so a rule that lives in a component
 * cannot be tested and a rule that lives here can.
 *
 * **Not {@link placeBubble}, and the difference is not cosmetic.** The tour's
 * bubble *points at* a thing: it may sit on any of the four sides, it centres
 * itself on the anchor, and it reports which side it chose so an arrow can
 * point back. A menu *hangs from* a thing: it stays vertically attached, it
 * keeps one edge flush with the trigger so the two read as one control, and it
 * has no arrow to aim. Sharing one function would mean a side-choosing
 * parameter that each caller passes a constant to.
 */

/** A viewport-space box, as `getBoundingClientRect` returns one. */
export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface AnchoredPoint {
  readonly top: number;
  readonly left: number;
}

/** How far a panel sits from the trigger it belongs to. */
export const ANCHOR_GAP = 6;

/** How close to the window's edge a panel may be pushed. */
const MARGIN = 8;

/**
 * The viewport point to pin a panel to, in `position: fixed` coordinates.
 *
 * `place` is a preference, not an instruction. A menu near the bottom of the
 * window flips above its trigger and one near the top flips below, because the
 * alternative is a list whose last item is off the screen — and the last item
 * of these menus is usually the destructive one, which is the worst possible
 * thing to have half visible. When neither side fits (a panel taller than the
 * window), the roomier side wins and the result is clamped, which puts the top
 * of the panel on screen: its top is where the first item is.
 *
 * `align` keeps one edge flush with the trigger. Clamping can break that when
 * the trigger is right against the window's edge, which is correct — an aligned
 * panel half outside the window is worse than a panel a few pixels off its mark.
 */
export function anchorPanel(
  anchor: Rect,
  panel: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  opts: {
    readonly place: "above" | "below";
    readonly align: "left" | "right";
    readonly gap?: number;
  },
): AnchoredPoint {
  const gap = opts.gap ?? ANCHOR_GAP;
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - panel.height - gap;

  const fitsBelow = below + panel.height <= viewport.height - MARGIN;
  const fitsAbove = above >= MARGIN;

  const roomBelow = viewport.height - (anchor.top + anchor.height);
  const roomAbove = anchor.top;

  const top =
    opts.place === "below"
      ? fitsBelow
        ? below
        : fitsAbove
          ? above
          : roomBelow >= roomAbove
            ? below
            : above
      : fitsAbove
        ? above
        : fitsBelow
          ? below
          : roomAbove >= roomBelow
            ? above
            : below;

  const left =
    opts.align === "right"
      ? anchor.left + anchor.width - panel.width
      : anchor.left;

  return {
    top: clamp(top, MARGIN, viewport.height - panel.height - MARGIN),
    left: clamp(left, MARGIN, viewport.width - panel.width - MARGIN),
  };
}

/**
 * Keep a value inside a range that may be empty.
 *
 * `min` wins when the range inverts — i.e. when the panel is larger than the
 * window. Pinning to `max` there would push the top off the screen, and the top
 * is where the panel's first item and its heading are. The same rule the tour's
 * bubble uses, for the same reason.
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
