import type { AvatarPreset } from "@gtp/types";

/**
 * The drawn avatars, as drawings.
 *
 * The *contract* owns the list of keys (`@gtp/types`), because the server
 * validates against it and the key is what gets stored. This owns what each one
 * looks like, because that is nobody's business but the board's.
 *
 * Drawn rather than typed, for the reason `CategoryIcon` gives: an emoji is
 * rendered by the reader's operating system, so the same avatar would be a flat
 * glyph on Windows, a glossy pictogram on iOS and a tofu box wherever the font
 * is missing — which is a poor property for the thing whose whole job is to be
 * recognisably *you* across a crew list.
 *
 * One stroke weight, one grid, `currentColor` throughout, so a mark sits on the
 * same generated hue the initials do. A person keeps one colour whether they
 * are wearing their letters or a tent.
 */

/** What each mark is called, for the picker's tooltip and accessible name.
 *  Not translated: they are the names of drawings, and a Hungarian reader
 *  choosing "tent" is choosing the picture, not reading a sentence. */
export const AVATAR_PRESET_NAME: Record<AvatarPreset, string> = {
  tent: "Tent",
  backpack: "Backpack",
  compass: "Compass",
  map: "Map",
  plane: "Plane",
  passport: "Passport",
  camera: "Camera",
  mountain: "Mountain",
  palm: "Palm tree",
  anchor: "Anchor",
  campfire: "Campfire",
  suitcase: "Suitcase",
};
