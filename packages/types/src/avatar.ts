import { z } from "zod";
import { CategoryPaletteKey } from "./categories.js";

/**
 * The drawn avatars, for anyone who does not want to upload a photograph.
 *
 * A generated pair of initials already covers "no picture", and it covers it
 * well: it is unique-ish, stable, and tells two people apart in a crew list.
 * What it cannot be is *chosen*. These can — a small set of travelling things,
 * picked because a trip board is the one place a tent or a passport says
 * something about the person using it.
 *
 * **Stored in `avatarUrl`, behind a `preset:` scheme.** No new column, and no
 * second field for six mappers (auth, member, message, dashboard, option, admin)
 * to remember to carry. The trade is that `avatarUrl` stops being strictly a
 * URL, which is why the scheme is explicit and there is one function that reads
 * it: nothing anywhere should be testing this with `startsWith("http")`.
 *
 * It is safe against the upload pipeline's clean-up by construction —
 * `StorageDriver.nameFromUrl` returns null for anything that is not one of our
 * own object URLs, so `discard("preset:tent")` is already a no-op.
 *
 * The mark is drawn client-side (`lib/avatarPresets`). It used to take the same
 * generated hue the initials do, so that one person kept one colour whichever
 * they wore; a colour is now something they can say for themselves, and the
 * generated hue is what a mark falls back to when they have not — see
 * {@link AVATAR_COLOUR_SEPARATOR}.
 */

/** The scheme that marks an `avatarUrl` as a drawn mark rather than an upload. */
export const AVATAR_PRESET_SCHEME = "preset:";

/**
 * What separates the mark from the colour it is drawn in: `preset:tent@SKY`.
 *
 * The colour rides in the same stored string for the same reason the mark does
 * — no second column, and no second field for six mappers to remember to carry.
 * A value with no separator is a mark from before colours were choosable and
 * means "draw it in the hue generated from my id", which is what every one of
 * them has always been drawn in. That is the whole of the migration.
 */
export const AVATAR_COLOUR_SEPARATOR = "@";

/**
 * The colours a drawn mark may be worn in — **the board's eight palettes**, not
 * a second set beside them.
 *
 * Sharing the list is the point. Those eight hues were chosen against two
 * constraints that apply here without a word of change: 0–15° belongs to
 * `--board-danger`, so a person whose avatar reads as an error is worse than
 * one with no colour at all, and 160–190° belongs to `--board-accent`, the teal
 * that means "this is the app talking". What is left is walked in even 40°
 * steps, which is past the point where two tints stop being separable at the
 * size a crew list draws them — and a crew list is a harder test of that than a
 * lane header, because the marks are smaller and there are more of them.
 *
 * Inventing a parallel avatar palette would have meant maintaining that
 * reasoning twice and having the two drift.
 */
export const AvatarColour = CategoryPaletteKey;
export type AvatarColour = z.infer<typeof AvatarColour>;

/** Every colour, in picker order — the ring walked once, warm to cool. */
export const AVATAR_COLOURS = AvatarColour.options;

/**
 * Every mark on offer. The keys are the stored value and are **never
 * renumbered or renamed** — a key that stops existing is somebody's avatar
 * quietly reverting to their initials.
 */
export const AVATAR_PRESETS = [
  "tent",
  "backpack",
  "compass",
  "map",
  "plane",
  "passport",
  "camera",
  "mountain",
  "palm",
  "anchor",
  "campfire",
  "suitcase",
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export const AvatarPreset = z.enum(AVATAR_PRESETS);

/** Client → server: wear a drawn mark. Replaces an uploaded picture if there
 *  was one; the object behind it is deleted on the way, as a removal would. */
export const SetAvatarPresetInput = z.object({
  preset: AvatarPreset,
  /** Optional so a client that does not offer colours still works — it writes a
   *  colourless value, which renders the way every mark did before. */
  colour: AvatarColour.optional(),
});
export type SetAvatarPresetInput = z.infer<typeof SetAvatarPresetInput>;

/**
 * The stored `avatarUrl` for a mark, optionally in a chosen colour.
 *
 * Colourless output is not a legacy path kept out of politeness — it is what a
 * caller with no colour to state should write, and it still renders exactly as
 * it did: the mark in the hue generated from the wearer's id.
 */
export function avatarPresetUrl(
  preset: AvatarPreset,
  colour?: AvatarColour | null,
): string {
  const mark = `${AVATAR_PRESET_SCHEME}${preset}`;
  return colour ? `${mark}${AVATAR_COLOUR_SEPARATOR}${colour}` : mark;
}

/**
 * Whether an `avatarUrl` is a drawn mark **at all**, known key or not.
 *
 * Separate from {@link avatarPresetOf} because the two answer different
 * questions, and conflating them renders a broken image: a value of
 * `preset:hovercraft` has no mark to draw, but it is emphatically not an
 * address either, and a renderer that only asked "which mark?" would hand it to
 * an `<img>`. Ask this first, then that.
 */
export function isAvatarPresetUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(AVATAR_PRESET_SCHEME));
}

/**
 * The preset an `avatarUrl` names, or `null` if it names anything else — an
 * uploaded picture, or nothing at all.
 *
 * Validated against the list rather than just the prefix, so a value written by
 * an older or newer build (or by hand) falls back to initials instead of
 * rendering an empty circle.
 */
export function avatarPresetOf(
  url: string | null | undefined,
): AvatarPreset | null {
  if (!url || !url.startsWith(AVATAR_PRESET_SCHEME)) return null;
  const key = url
    .slice(AVATAR_PRESET_SCHEME.length)
    .split(AVATAR_COLOUR_SEPARATOR)[0];
  return AvatarPreset.safeParse(key).success ? (key as AvatarPreset) : null;
}

/**
 * The colour a mark is worn in, or `null` for one that names none.
 *
 * A third question rather than a wider answer from {@link avatarPresetOf},
 * which is the same split this file already draws between "is this a mark?"
 * and "which mark?": a caller that only wants to know what to draw should not
 * have to destructure a pair to find out, and every existing call site keeps
 * asking exactly what it asked before.
 *
 * Null covers three genuinely different cases on purpose — not a mark at all, a
 * mark stored before colours existed, and a colour this build does not know —
 * because the answer to all three is the same: fall back to the hue generated
 * from the wearer's id, which is never absent and never wrong.
 */
export function avatarColourOf(
  url: string | null | undefined,
): AvatarColour | null {
  if (!url || !url.startsWith(AVATAR_PRESET_SCHEME)) return null;
  const parts = url
    .slice(AVATAR_PRESET_SCHEME.length)
    .split(AVATAR_COLOUR_SEPARATOR);
  if (parts.length < 2) return null;
  const key = parts[1];
  return AvatarColour.safeParse(key).success ? (key as AvatarColour) : null;
}

/**
 * A mark and a colour, picked at random — what a new account is given.
 *
 * Nobody starts as a blank. Initials on a generated hue were the old answer and
 * they are a fine *fallback*, but as a default they made the first thing a
 * person contributes to a board look like a placeholder for a decision they had
 * not made yet. A tent in violet is somebody; "AB" in violet is a field that is
 * still empty.
 *
 * The random source is a parameter so a test can pin it. It is the only impure
 * thing in this file, which is why it is the only thing here that takes one.
 */
export function randomAvatarLook(rand: () => number = Math.random): {
  preset: AvatarPreset;
  colour: AvatarColour;
} {
  const preset = AVATAR_PRESETS[Math.floor(rand() * AVATAR_PRESETS.length)]!;
  const colour = AVATAR_COLOURS[Math.floor(rand() * AVATAR_COLOURS.length)]!;
  return { preset, colour };
}
