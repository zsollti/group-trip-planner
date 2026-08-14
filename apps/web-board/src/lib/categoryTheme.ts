import {
  CATEGORY_PALETTE_KEYS,
  type CategoryBuiltinKey,
  type CategoryPaletteKey,
} from "@gtp/types";

/**
 * A category's visual identity: the palette it wears and the icon that marks it.
 *
 * A palette is **three colours, one hue**, and each has a job:
 *
 * - **main** — the lane's top edge and a decision's left edge. The full-strength
 *   colour, used as a line, never as a field behind text.
 * - **locked** — the fill behind a settled option. The same colour, pale.
 * - **proposed** — the fill behind a candidate. Paler still *and* greyer, so a
 *   lane of candidates reads as quieter than the one card that was chosen.
 *
 * The greying is what makes the two fills tell a story rather than just differ.
 * Weakening a tint alone says "less of the same"; draining the colour out of it
 * says "not settled" — the board's own reading of the difference, since a
 * decision is the thing that earns full colour.
 *
 * **Which palette is a choice; what a palette *is* is not.** The key travels on
 * the category ({@link CategoryPaletteKey}); every value below is the board's,
 * and light and dark answer differently — see the `--cat-*` scale in
 * `index.css`. A category with no key falls back to the derived default, so an
 * untouched board looks exactly as it always did.
 *
 * Colour is **reinforcement, never the message**. The category's name sits
 * beside it in full-contrast ink everywhere the palette appears, so nothing is
 * conveyed by colour alone (WCAG 1.4.1) and a reader who cannot separate two
 * hues has lost nothing. That is also why a palette only ever tints a surface or
 * an edge and never becomes text on a coloured field: the token contract in
 * `index.css` guarantees every foreground pair clears AA in both themes, and a
 * per-category text colour would quietly make that claim false.
 */

/**
 * Every hue the board will hand out, as HSL degrees, keyed by palette name.
 *
 * Two bands are deliberately empty. **0–15** belongs to `--board-danger`, and a
 * lane that reads as an error is worse than a lane with no colour at all;
 * **160–190** belongs to `--board-accent`, the teal that means "this is the app
 * talking" (focus rings, primary buttons, a settled card's edge) — a category
 * wearing it would blur that line. What is left is walked in even 40° steps,
 * which is comfortably past the ~35° at which two tints at this saturation stop
 * being separable at the size a lane header renders them.
 *
 * These are the same eight hues the board already handed out before any of it
 * was choosable — four pinned to built-ins, four to custom lanes — so naming
 * them changed nothing on any existing board. That was the point: a palette
 * picker whose defaults recoloured every trip on the day it shipped would have
 * been a redesign wearing a feature's clothes.
 */
const PALETTE_HUES: Record<CategoryPaletteKey, number> = {
  AMBER: 25,
  GOLD: 60,
  LIME: 100,
  JADE: 140,
  SKY: 200,
  INDIGO: 240,
  VIOLET: 280,
  ROSE: 320,
};

/**
 * The palette each built-in wears unless someone picks another, keyed on the
 * identity that survives a rename (the whole reason `builtinKey` exists).
 *
 * Which built-in gets which is decided by **where they sit next to each other**,
 * not by what the words evoke. The seed order is Dates, Transport,
 * Accommodation, Activities, so those are the pairs a reader compares. An
 * earlier assignment gave Dates indigo and Transport sky — 40° apart, the
 * smallest gap in the ring, and it put the two blues side by side in the first
 * two lanes, which is exactly where the row is least readable. Rendering it
 * settled the question: they were separable, but only just, and only if you
 * looked.
 */
const BUILTIN_PALETTES: Record<CategoryBuiltinKey, CategoryPaletteKey> = {
  DATES: "ROSE",
  TRANSPORT: "SKY",
  ACCOMMODATION: "AMBER",
  ACTIVITIES: "INDIGO",
  // Retired from the seed, not removed: trips created before it was retired
  // still carry a Budget row, and this map has to be total over the enum or
  // those lanes render with no colour at all.
  BUDGET: "GOLD",
};

/**
 * What a custom category draws from, disjoint from the four seeded palettes so a
 * lane someone made can never be mistaken for a built-in.
 *
 * Gold is shared with retired Budget, which is the one collision worth
 * accepting: nothing creates a Budget category any more, and a legacy lane
 * matching a custom one is a cosmetic tie, not a mixed signal. The picker
 * offers all eight regardless — this is only the starting point.
 */
const CUSTOM_PALETTES: readonly CategoryPaletteKey[] = [
  "LIME",
  "JADE",
  "VIOLET",
  "GOLD",
];

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

/** The fields these functions actually read off a category. */
export interface CategoryIdentity {
  readonly id: string;
  readonly builtinKey: CategoryBuiltinKey | null;
  /** The chosen palette, or null for the derived default. */
  readonly paletteKey?: CategoryPaletteKey | null;
}

/**
 * The palette this category wears: the chosen one, or the default it has always
 * had. Total and deterministic — a board renders the same colours on every
 * device, signed in or not, with nothing stored until somebody actually picks.
 */
export function categoryPalette(
  category: CategoryIdentity,
): CategoryPaletteKey {
  if (category.paletteKey) return category.paletteKey;
  if (category.builtinKey !== null)
    return BUILTIN_PALETTES[category.builtinKey];
  return CUSTOM_PALETTES[
    hashIndex(category.id, CUSTOM_PALETTES.length)
  ] as CategoryPaletteKey;
}

/** The hue, in HSL degrees, a palette is built from. */
export function paletteHue(key: CategoryPaletteKey): number {
  return PALETTE_HUES[key];
}

/** The hue this category renders in. */
export function categoryHue(category: CategoryIdentity): number {
  return paletteHue(categoryPalette(category));
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
 * The inline style that carries a palette to everything inside it.
 *
 * A hue number, not three colours: the *value* is one number and every surface
 * decides what to do with it, so light and dark can pick their own lightness and
 * saturation from one source. Set it on the lane and the cards inherit it — but
 * the cards set it themselves too, because a card also renders inside a drag
 * overlay (portalled out of the lane) and on the timeline (which has no lanes at
 * all), where inheritance has nothing to inherit from.
 */
export function categoryHueStyle(
  category: CategoryIdentity,
): Record<string, string> {
  return { "--cat-hue": String(categoryHue(category)) };
}

/** The same, from a bare palette key — for the picker's own swatches. */
export function paletteHueStyle(
  key: CategoryPaletteKey,
): Record<string, string> {
  return { "--cat-hue": String(paletteHue(key)) };
}

/**
 * The same again, for a surface that knows a category only by id — the cost
 * charts, which are drawn from cost lines rather than from the lanes.
 *
 * Undefined for a null id or a category that is not in the list, which is the
 * useful answer: the caller sets no hue and CSS supplies its own neutral, which
 * is exactly what the folded tail wants.
 */
export function categoryHueStyleById(
  categoryId: string | null,
  categories: readonly CategoryIdentity[],
): Record<string, string> | undefined {
  if (categoryId === null) return undefined;
  const category = categories.find((c) => c.id === categoryId);
  return category ? categoryHueStyle(category) : undefined;
}

/** Every palette, in picker order. Re-exported so callers need one import. */
export const PALETTE_KEYS = CATEGORY_PALETTE_KEYS;

/** Title-case name for a palette, for the picker's labels and its a11y names. */
export function paletteLabel(key: CategoryPaletteKey): string {
  return key.charAt(0) + key.slice(1).toLowerCase();
}
