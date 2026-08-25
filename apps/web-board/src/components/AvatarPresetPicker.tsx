import { AVATAR_PRESETS, avatarPresetOf, type AvatarPreset } from "@gtp/types";
import { AVATAR_PRESET_NAME } from "../lib/avatarPresets";
import { AvatarPresetMark } from "./AvatarPresetMark";
import { avatarHue } from "../lib/avatar";
import { t } from "../lib/i18n";
import type { CSSProperties } from "react";

/**
 * The drawn marks, to pick one from.
 *
 * A grid of the thing itself rather than a list of names: these are pictures,
 * and the only question the reader has is which one they like. Each still
 * carries its name on `title` and `aria-label`, because "which one is selected"
 * has to be answerable without seeing them.
 *
 * Every swatch is drawn on the reader's **own** generated hue — the same colour
 * their initials already use — so the grid previews the actual avatar rather
 * than a set of neutral icons that will change colour once chosen.
 */
export function AvatarPresetPicker({
  userId,
  currentUrl,
  busy,
  onPick,
}: {
  /** Seeds the hue, so the swatches are this person's colour. */
  userId: string | undefined;
  /** The avatar as stored — a `preset:` value marks one of these as current. */
  currentUrl: string | null;
  busy: boolean;
  onPick: (preset: AvatarPreset) => void;
}) {
  const current = avatarPresetOf(currentUrl);
  const hue = { "--avatar-hue": avatarHue(userId ?? "") } as CSSProperties;

  return (
    <div className="presets">
      <p className="board__panel-note">
        {t("Or wear one of these instead — no photo needed.")}
      </p>
      <ul className="presets__grid" style={hue}>
        {AVATAR_PRESETS.map((preset) => {
          const name = AVATAR_PRESET_NAME[preset];
          return (
            <li key={preset}>
              <button
                type="button"
                className={
                  "presets__swatch" +
                  (preset === current ? " presets__swatch--current" : "")
                }
                // Marked rather than disabled: pressing the one you already
                // wear is a no-op, not something to be stopped from doing, and
                // a disabled swatch in a grid of twelve reads as unavailable.
                aria-pressed={preset === current}
                disabled={busy}
                title={name}
                aria-label={name}
                onClick={() => onPick(preset)}
              >
                <AvatarPresetMark preset={preset} size={44} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
