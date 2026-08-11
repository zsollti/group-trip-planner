import type { CategoryBuiltinKey, CategoryView } from "@gtp/types";

/**
 * A category's visual identity: the hue it wears and the icon that marks it.
 *
 * **Derived, never stored.** A colour column plus a picker would be a migration,
 * a contract change and a decision to make on every category anyone creates —
 * for a property nobody needs to choose. The four built-ins get a pinned hue
 * keyed on `builtinKey`, which survives a rename (the whole reason that key
 * exists); a custom category hashes its id, so its colour is stable across
 * sessions, devices and readers without anything being persisted. Same technique
 * as the generated avatar in `lib/avatar` — a mark exists to tell things apart at
 * a glance, and a deterministic one does that for free.
 *
 * Colour is **reinforcement, never the message**. The category's name sits
 * beside it in full-contrast ink everywhere the hue appears, so nothing is
 * conveyed by colour alone (WCAG 1.4.1) and a reader who cannot separate two
 * hues has lost nothing. That is also why the hue only ever tints a surface or
 * an edge and never becomes text on a coloured field: the token contract in
 * `index.css` guarantees every foreground pair clears AA in both themes, and a
 * per-category text colour would quietly make that claim false.
 */

/**
 * Every hue the board will hand out, as HSL degrees.
 *
 * Two bands are deliberately empty. **0–15** belongs to `--board-danger`, and a
 * lane that reads as an error is worse than a lane with no colour at all;
 * **160–190** belongs to `--board-accent`, the teal that means "this is the app
 * talking" (focus rings, primary buttons, a settled card's edge) — a category
 * wearing it would blur that line. What is left is spaced so no two entries sit
 * closer than 35°, which is about where two tints at this saturation stop being
 * separable at the size a lane header renders them.
 */
/*
 * Which built-in gets which hue is decided by **where they sit next to each
 * other**, not by what the words evoke. The seed order is Dates, Transport,
 * Accommodation, Activities, so those are the pairs a reader compares. An
 * earlier assignment gave Dates 240 and Transport 200 — 40° apart, the smallest
 * gap in the ring, and it put the two blues side by side in the first two lanes,
 * which is exactly where the row is least readable. Rendering it settled that:
 * they were separable, but only just, and only if you looked.
 */
const DATES_HUE = 320;
const TRANSPORT_HUE = 200;
const ACCOMMODATION_HUE = 25;
const ACTIVITIES_HUE = 240;
const BUDGET_HUE = 60;

/** Pinned hues for the built-ins, keyed on the identity that survives a rename. */
const BUILTIN_HUES: Record<CategoryBuiltinKey, number> = {
  DATES: DATES_HUE,
  TRANSPORT: TRANSPORT_HUE,
  ACCOMMODATION: ACCOMMODATION_HUE,
  ACTIVITIES: ACTIVITIES_HUE,
  // Retired from the seed, not removed: trips created before it was retired
  // still carry a Budget row, and this map has to be total over the enum or
  // those lanes render with no hue at all.
  BUDGET: BUDGET_HUE,
};

/**
 * The hues a custom category can draw, disjoint from the four seeded ones so a
 * lane someone made can never be mistaken for a built-in. Four of them because
 * `maxTripCategories` allows eight categories and four of those are seeded —
 * so a trip at the cap can still give every custom lane its own colour.
 *
 * Gold is shared with retired Budget, which is the one collision worth
 * accepting: nothing creates a Budget category any more, and a legacy lane
 * matching a custom one is a cosmetic tie, not a mixed signal.
 */
const CUSTOM_HUES = [100, 140, 280, BUDGET_HUE] as const;

/**
 * A stable index from a seed. Same rolling hash as `avatarHue` — kept as its own
 * copy rather than shared because the two answer different questions (one picks
 * from a curated ring, the other takes the whole colour wheel) and folding them
 * together would mean changing both to change either.
 */
function hashIndex(seed: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % buckets;
}

/** The hue, in HSL degrees, this category wears. Total and deterministic. */
export function categoryHue(category: {
  readonly id: string;
  readonly builtinKey: CategoryBuiltinKey | null;
}): number {
  if (category.builtinKey !== null) return BUILTIN_HUES[category.builtinKey];
  return CUSTOM_HUES[hashIndex(category.id, CUSTOM_HUES.length)] as number;
}

/**
 * Which glyph marks this category.
 *
 * Every custom category shares one mark on purpose. A per-category icon would
 * need either a picker (a decision to make on something most people will never
 * think about) or a guess from the name (which is wrong the moment someone
 * writes "Kirándulás"). One honest "this is yours" mark says what is true: the
 * colour is what tells two custom lanes apart, and the name does the rest.
 */
export type CategoryIconKey = CategoryBuiltinKey | "CUSTOM";

export function categoryIconKey(category: {
  readonly builtinKey: CategoryBuiltinKey | null;
}): CategoryIconKey {
  return category.builtinKey ?? "CUSTOM";
}

/**
 * The inline style that carries a category's hue to everything inside it.
 *
 * A custom property, not a colour: the *value* is one number and every surface
 * decides what to do with it, so light and dark can pick their own lightness
 * from one source. Set it on the lane and the cards inherit it — but the cards
 * set it themselves too, because a card also renders inside a drag overlay
 * (portalled out of the lane) and on the timeline (which has no lanes at all),
 * where inheritance has nothing to inherit from.
 */
export function categoryHueStyle(category: {
  readonly id: string;
  readonly builtinKey: CategoryBuiltinKey | null;
}): Record<string, string> {
  return { "--cat-hue": String(categoryHue(category)) };
}

/** Narrowing helper: the fields these functions actually read off a category. */
export type CategoryIdentity = Pick<CategoryView, "id" | "builtinKey">;
