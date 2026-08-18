import type { ReactNode } from "react";
import type { CategoryIconKey } from "./categoryTheme";

/**
 * The drawings behind {@link CategoryIcon}, kept apart from it.
 *
 * They live here rather than beside the component because **two** surfaces draw
 * them and neither can use the other's wrapper: a lane header wants an `<svg>`
 * of its own, and the cost ring wants a `<g>` inside the chart's SVG. One set of
 * paths is what makes the mark on a wedge and the mark on a lane the same mark —
 * which is the entire reason the ring can carry a glyph and no legend.
 *
 * (It is also its own module because a file that exports both a component and a
 * constant loses fast refresh.)
 */

/**
 * One 24×24 outline, stroked so all six read as one family at small sizes.
 *
 * Exported because the cost ring draws these too, and it cannot use
 * {@link CategoryIcon}: a wedge's mark is a `<g>` inside the chart's own SVG,
 * not an `<svg>` of its own, so it needs the paths rather than the wrapper.
 */
export const CATEGORY_ICON_PATHS: Record<CategoryIconKey, ReactNode> = {
  // A calendar — the question this lane asks is "when".
  DATES: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  // An aircraft from above: nose up, wings swept back, tailplane at the foot.
  TRANSPORT: (
    <path d="M10.5 19.5 12 21l1.5-1.5V15l7.5 2.2V15L13.5 10V4.5a1.5 1.5 0 0 0-3 0V10L3 15v2.2L10.5 15z" />
  ),
  // A bed: headboard, mattress, pillow.
  ACCOMMODATION: (
    <>
      <path d="M2 19v-9M2 14h20v5M22 19v-5a3 3 0 0 0-3-3h-8v3" />
      <circle cx="6.5" cy="8.5" r="2" />
    </>
  ),
  // A compass — the lane for what you actually go and do.
  ACTIVITIES: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  // A banknote. Retired from the seed, still worn by pre-retirement trips.
  BUDGET: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  // A luggage tag: one mark for every category a group made itself. See
  // `categoryIconKey` for why they share it rather than each getting their own.
  CUSTOM: (
    <>
      <path d="M11.6 3H5a2 2 0 0 0-2 2v6.6a2 2 0 0 0 .6 1.4l7.4 7.4a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8L13 3.6a2 2 0 0 0-1.4-.6z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
};
