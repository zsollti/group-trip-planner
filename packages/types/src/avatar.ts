import { z } from "zod";

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
 * The mark is drawn client-side (`lib/avatarPresets`), on the same generated
 * hue the initials use: one person keeps one colour whether they are wearing
 * their letters or a tent.
 */

/** The scheme that marks an `avatarUrl` as a drawn mark rather than an upload. */
export const AVATAR_PRESET_SCHEME = "preset:";

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
});
export type SetAvatarPresetInput = z.infer<typeof SetAvatarPresetInput>;

/** The stored `avatarUrl` for a preset. */
export function avatarPresetUrl(preset: AvatarPreset): string {
  return `${AVATAR_PRESET_SCHEME}${preset}`;
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
  const key = url.slice(AVATAR_PRESET_SCHEME.length);
  return AvatarPreset.safeParse(key).success ? (key as AvatarPreset) : null;
}
