import { useState, type CSSProperties } from "react";
import {
  AVATAR_COLOURS,
  AVATAR_PRESETS,
  avatarColourOf,
  avatarPresetOf,
  avatarPresetUrl,
  type AvatarColour,
  type AvatarPreset,
} from "@gtp/types";
import { AVATAR_PRESET_NAME } from "../lib/avatarPresets";
import { Avatar } from "./Avatar";
import { AvatarPresetMark } from "./AvatarPresetMark";
import { avatarHue } from "../lib/avatar";
import { paletteHue, paletteLabel } from "../lib/categoryTheme";
import { t } from "../lib/i18n";

/**
 * A mark, and the colour it is worn in — two strips rather than one grid.
 *
 * The grid drew every mark on the reader's own generated hue, which made it a
 * choice of *one* thing: twelve pictures in the colour an id happened to hash
 * to. Colour is the half people actually want, and it was the half nobody
 * could touch. Crossing the two lists in one grid would be ninety-six swatches
 * on an account page, so they are two rows instead and the reader combines
 * them — which is also the only arrangement where "I want the blue one" is a
 * single tap rather than a hunt.
 *
 * **Each strip scrolls sideways.** A row that wraps to three lines stops being
 * a row, and the marks are the kind of thing you flick through rather than
 * survey; the selected one is what the eye returns to, and it is marked with
 * the app's accent and a ring rather than by colour alone — which it has to be
 * here more than anywhere, since half of these swatches *are* colours.
 *
 * **Colour alone cannot be stored.** A drawn avatar is a mark plus a colour and
 * the mark is the required half, so for the handful of readers wearing neither
 * — an account from before this existed, or one wearing a photograph — a colour
 * tap stages rather than commits, and the note says so. Committing it by
 * silently choosing a mark for them would take a photograph off somebody who
 * tapped a colour swatch to see what it looked like.
 */
export function AvatarPresetPicker({
  name,
  userId,
  currentUrl,
  busy,
  onPick,
}: {
  /** For the preview's initials, in the case where there is no mark to draw. */
  name: string;
  /** Seeds the fallback hue — what a mark with no colour of its own is drawn in. */
  userId: string | undefined;
  /** The avatar as stored; a `preset:` value marks one of these as current. */
  currentUrl: string | null;
  busy: boolean;
  onPick: (preset: AvatarPreset, colour: AvatarColour) => void;
}) {
  const wornPreset = avatarPresetOf(currentUrl);
  const wornColour = avatarColourOf(currentUrl);

  /**
   * The colour the reader has asked for but cannot yet wear.
   *
   * Only ever set for someone with no mark on: the moment there is a mark, a
   * colour tap is a commit and there is nothing to stage. Cleared implicitly by
   * that commit, since `wornColour` then answers for it.
   */
  const [stagedColour, setStagedColour] = useState<AvatarColour | null>(null);

  const colour = wornColour ?? stagedColour;
  const hue = colour ? paletteHue(colour) : avatarHue(userId ?? "");
  const tint = { "--avatar-hue": String(hue) } as CSSProperties;

  function chooseColour(next: AvatarColour) {
    // With a mark on, this is a commit: same mark, new colour.
    if (wornPreset) {
      onPick(wornPreset, next);
      return;
    }
    setStagedColour(next);
  }

  function choosePreset(next: AvatarPreset) {
    // Whatever colour is showing — the worn one, the staged one, or the hue
    // their id generates, which is what the preview has been drawing all along.
    onPick(next, colour ?? nearestColour(hue));
  }

  return (
    <div className="presets" style={tint}>
      <p className="board__panel-note">
        {t("Or wear one of these instead — no photo needed.")}
      </p>

      {/* The combination, at the size an avatar is actually read at. Two strips
          asking two questions need somewhere the answers meet, or the reader is
          composing a picture they cannot see until they have committed it.
          Drawn by `Avatar` from a composed value rather than by hand, so what
          this shows and what a crew list shows cannot drift: it is the same
          component reading the same string. With no mark on there is nothing to
          compose and it shows the initials, which is what that reader is in
          fact wearing; the staged colour is visible on the strip below, marked
          as chosen, and the note under it says what is still missing. */}
      <div className="presets__preview">
        <Avatar
          name={name}
          userId={userId}
          url={wornPreset ? avatarPresetUrl(wornPreset, colour) : null}
          size={64}
        />
      </div>

      <Strip label={t("Colour")}>
        {AVATAR_COLOURS.map((key) => {
          const label = paletteLabel(key);
          return (
            <li key={key}>
              <button
                type="button"
                className={
                  "presets__swatch presets__swatch--colour" +
                  (key === colour ? " presets__swatch--current" : "")
                }
                style={
                  { "--avatar-hue": String(paletteHue(key)) } as CSSProperties
                }
                aria-pressed={key === colour}
                disabled={busy}
                title={label}
                aria-label={label}
                onClick={() => chooseColour(key)}
              />
            </li>
          );
        })}
      </Strip>

      <Strip label={t("Mark")}>
        {AVATAR_PRESETS.map((preset) => {
          const label = AVATAR_PRESET_NAME[preset];
          return (
            <li key={preset}>
              <button
                type="button"
                className={
                  "presets__swatch" +
                  (preset === wornPreset ? " presets__swatch--current" : "")
                }
                // Marked rather than disabled: pressing the one you already
                // wear is a no-op, not something to be stopped from doing, and
                // a disabled swatch in a row of twelve reads as unavailable.
                aria-pressed={preset === wornPreset}
                disabled={busy}
                title={label}
                aria-label={label}
                onClick={() => choosePreset(preset)}
              >
                <AvatarPresetMark preset={preset} size={44} />
              </button>
            </li>
          );
        })}
      </Strip>

      {/* Only where it is true, and only for as long as it is. */}
      {!wornPreset && stagedColour ? (
        <p className="board__panel-note" role="status">
          {t("Pick a mark to wear it in this colour.")}
        </p>
      ) : null}
    </div>
  );
}

/** One labelled row of swatches that scrolls sideways rather than wrapping. */
function Strip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="presets__row">
      <p className="presets__row-label">{label}</p>
      <ul className="presets__strip">{children}</ul>
    </div>
  );
}

/**
 * The palette closest to a hue, for the one case that has no colour to carry.
 *
 * A reader wearing initials has only the hue generated from their id, and the
 * preview has been drawing their mark in it. Picking a mark has to store *some*
 * colour, and storing the nearest palette to what they were already looking at
 * is the only choice that does not change the thing under their finger as they
 * press it.
 *
 * Wrapping distance, not absolute: hue is a ring, so 350° is 30° from 20° and
 * not 330°.
 */
function nearestColour(hue: number): AvatarColour {
  // Annotated: `AVATAR_COLOURS` is a readonly tuple, so `[0]` narrows to the
  // single literal "AMBER" and nothing else could be assigned to it.
  let best: AvatarColour = AVATAR_COLOURS[0]!;
  let bestGap = 360;
  for (const key of AVATAR_COLOURS) {
    const raw = Math.abs(paletteHue(key) - hue) % 360;
    const gap = Math.min(raw, 360 - raw);
    if (gap < bestGap) {
      bestGap = gap;
      best = key;
    }
  }
  return best;
}
