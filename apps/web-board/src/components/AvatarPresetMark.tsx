import type { AvatarPreset } from "@gtp/types";
import { PRESET_PATHS } from "../lib/avatarPresetPaths";

/**
 * One mark, sized to the circle it sits in.
 *
 * `aria-hidden`, always. Wherever an avatar appears the name is beside it, and
 * the mark is a way of recognising a person rather than a fact about them — a
 * screen reader announcing "tent" beside "Ada Lovelace" would be describing the
 * decoration and not the person.
 */
export function AvatarPresetMark({
  preset,
  size,
}: {
  preset: AvatarPreset;
  size: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={Math.round(size * 0.58)}
      height={Math.round(size * 0.58)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PRESET_PATHS[preset]}
    </svg>
  );
}
