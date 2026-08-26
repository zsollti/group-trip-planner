import { useState, type CSSProperties } from "react";
import {
  AVATAR_COLOURS,
  AVATAR_PRESETS,
  avatarColourOf,
  avatarPresetOf,
  avatarPresetUrl,
  isAvatarPresetUrl,
  type AvatarColour,
  type AvatarPreset,
} from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { AVATAR_PRESET_NAME } from "../lib/avatarPresets";
import { Avatar } from "./Avatar";
import { AvatarPresetMark } from "./AvatarPresetMark";
import { Dialog } from "./Dialog";
import { ImagePicker } from "./ImagePicker";
import { avatarHue } from "../lib/avatar";
import { paletteHue, paletteLabel } from "../lib/categoryTheme";
import { t } from "../lib/i18n";

/** How many of a strip's items are on screen at once. */
const WINDOW = 3;

/**
 * What you are wearing, and the three ways to change it.
 *
 * **One picture, not two.** The panel used to show the uploader's frame and the
 * marks' preview side by side, which meant a reader wearing a drawn tent saw
 * their tent *and* a box reading "No image yet" — the panel asking its own
 * question twice and answering it two different ways. There is one circle now,
 * and it shows what a crew list would show: the photograph if there is one, the
 * mark if that is what is on, initials if neither.
 *
 * **A colour tap does not silently delete a photograph.** Wearing a mark
 * removes the uploaded file on the server, and the file is gone rather than
 * stashed — so the first tap on either strip by somebody wearing a photo asks
 * first, once. Answering yes lets the preview switch to the drawn avatar
 * immediately, which is the point of a preview; it is committed when a *mark*
 * is chosen, because a colour on its own is not something the account can
 * store (see `AVATAR_COLOURS` — the mark is the required half).
 *
 * **Three at a time, and it wraps.** Twelve marks and eight colours as two full
 * rows was a wall of swatches on a settings page, and a row that scrolled had a
 * scrollbar under it and hid the fact that there was more. A window of three
 * with an arrow either side says "there are more, one step that way" in a shape
 * everybody already knows, and going off one end comes back on the other so
 * there is no dead end to hit.
 */
export function AvatarField({
  name,
  userId,
  currentUrl,
  busy,
  error,
  onWear,
  onUpload,
  onRemovePhoto,
}: {
  name: string;
  /** Seeds the fallback hue — what a mark with no colour of its own is drawn in. */
  userId: string | undefined;
  /** The avatar as stored: a URL, a `preset:` value, or nothing. */
  currentUrl: string | null;
  busy: boolean;
  error: string | null;
  onWear: (preset: AvatarPreset, colour: AvatarColour) => void;
  onUpload: (file: File) => void;
  /** Absent when there is no uploaded picture to remove. */
  onRemovePhoto?: () => void;
}) {
  const wornPreset = avatarPresetOf(currentUrl);
  const wornColour = avatarColourOf(currentUrl);
  const wearsPhoto = Boolean(currentUrl) && !isAvatarPresetUrl(currentUrl);

  /**
   * The colour the reader has asked for but cannot yet wear.
   *
   * Only ever set while there is no mark on: the moment there is one, a colour
   * tap is a commit and there is nothing to stage.
   */
  const [stagedColour, setStagedColour] = useState<AvatarColour | null>(null);
  /** Answered yes to "this will delete your photo" — asked once, not per tap. */
  const [released, setReleased] = useState(false);
  /** The tap that is waiting on that answer. */
  const [asking, setAsking] = useState<
    | { kind: "colour"; colour: AvatarColour }
    | { kind: "mark"; preset: AvatarPreset }
    | null
  >(null);

  const colour = wornColour ?? stagedColour;
  const hue = colour ? paletteHue(colour) : avatarHue(userId ?? "");
  const tint = { "--avatar-hue": String(hue) } as CSSProperties;

  // What the one circle shows. A photo stays until the reader has agreed to
  // lose it; after that the preview is the drawn avatar they are building,
  // which for a colour with no mark yet is their initials in that colour.
  const shown = wornPreset
    ? avatarPresetUrl(wornPreset, colour)
    : wearsPhoto && !released
      ? currentUrl
      : null;

  function commitColour(next: AvatarColour) {
    // With a mark on, this is a commit: same mark, new colour.
    if (wornPreset) {
      onWear(wornPreset, next);
      return;
    }
    setStagedColour(next);
  }

  function commitPreset(next: AvatarPreset) {
    // Whatever colour is showing — the worn one, the staged one, or the hue
    // their id generates, which is what the preview has been drawing all along.
    onWear(next, colour ?? nearestColour(hue));
  }

  function chooseColour(next: AvatarColour) {
    if (wearsPhoto && !released) {
      setAsking({ kind: "colour", colour: next });
      return;
    }
    commitColour(next);
  }

  function choosePreset(next: AvatarPreset) {
    if (wearsPhoto && !released) {
      setAsking({ kind: "mark", preset: next });
      return;
    }
    commitPreset(next);
  }

  function confirmRelease() {
    const pick = asking;
    setAsking(null);
    setReleased(true);
    if (!pick) return;
    if (pick.kind === "colour") setStagedColour(pick.colour);
    else commitPreset(pick.preset);
  }

  return (
    <div className="avatarfield" style={tint}>
      {/* The one circle, drawn by `Avatar` from a composed value rather than by
          hand, so what this shows and what a crew list shows cannot drift. */}
      <div className="avatarfield__preview">
        <Avatar name={name} userId={userId} url={shown} size={96} />
      </div>

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* The uploader, without its own frame: the circle above is the preview
          for every way of having an avatar, not just for the uploaded one. */}
      <ImagePicker
        // Still the file input's accessible name, which is why it is a real
        // string and not dropped — see `labelHidden`.
        label={t("Your picture")}
        labelHidden
        framed={false}
        centred
        shape="square"
        currentUrl={wearsPhoto ? currentUrl : null}
        busy={busy}
        // The circle is chosen before the upload: the server resizes to fit and
        // CSS then crops to the middle, so an off-centre face used to become a
        // picture of a shoulder.
        cropCircle
        onSave={onUpload}
        onRemove={onRemovePhoto}
      />

      <Strip
        label={t("Colour")}
        count={AVATAR_COLOURS.length}
        currentIndex={colour ? AVATAR_COLOURS.indexOf(colour) : -1}
        previousLabel={t("Previous colour")}
        nextLabel={t("Next colour")}
        render={(i) => {
          const key = AVATAR_COLOURS[i]!;
          const label = paletteLabel(key);
          return (
            <button
              key={key}
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
          );
        }}
      />

      <Strip
        label={t("Mark")}
        count={AVATAR_PRESETS.length}
        currentIndex={wornPreset ? AVATAR_PRESETS.indexOf(wornPreset) : -1}
        previousLabel={t("Previous mark")}
        nextLabel={t("Next mark")}
        render={(i) => {
          const preset = AVATAR_PRESETS[i]!;
          const label = AVATAR_PRESET_NAME[preset];
          return (
            <button
              key={preset}
              type="button"
              className={
                "presets__swatch" +
                (preset === wornPreset ? " presets__swatch--current" : "")
              }
              // Marked rather than disabled: pressing the one you already wear
              // is a no-op, not something to be stopped from doing, and a
              // disabled swatch in a row reads as unavailable.
              aria-pressed={preset === wornPreset}
              disabled={busy}
              title={label}
              aria-label={label}
              onClick={() => choosePreset(preset)}
            >
              <AvatarPresetMark preset={preset} size={40} />
            </button>
          );
        }}
      />

      {/* Only where it is true, and only for as long as it is. */}
      {!wornPreset && stagedColour ? (
        <p className="board__panel-note" role="status">
          {t("Pick a mark to wear it in this colour.")}
        </p>
      ) : null}

      {asking ? (
        <Dialog
          title={t("Replace your photo?")}
          onClose={() => setAsking(null)}
        >
          <p>
            {t(
              "A drawn avatar takes the place of your uploaded picture, and the picture is deleted. You can always upload another one.",
            )}
          </p>
          <div className="board__panel-action">
            <Button type="button" variant="primary" onClick={confirmRelease}>
              {t("Use a drawn avatar")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAsking(null)}
            >
              {t("Keep my photo")}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * One labelled row of three, with an arrow either side.
 *
 * The window is an offset into the list and the list is read modulo its own
 * length, which is the whole of "it spins": there is no clone of the items at
 * either end, no scroll position to keep, and no scrollbar to hide. It opens on
 * the item that is currently worn, so a reader whose mark is the eleventh does
 * not have to go looking for it to see it is theirs.
 */
function Strip({
  label,
  count,
  currentIndex,
  previousLabel,
  nextLabel,
  render,
}: {
  label: string;
  count: number;
  /** Index of the item being worn, or -1. Decides where the window opens. */
  currentIndex: number;
  previousLabel: string;
  nextLabel: string;
  render: (index: number) => React.ReactNode;
}) {
  // Centred on the worn item where there is one: with a window of three, that
  // is the item before it.
  const [first, setFirst] = useState(() =>
    currentIndex < 0 ? 0 : (currentIndex - 1 + count) % count,
  );

  const step = (by: number) => setFirst((f) => (f + by + count) % count);
  const shown = Array.from(
    { length: Math.min(WINDOW, count) },
    (_, i) => (first + i) % count,
  );

  return (
    <div className="presets__row" role="group" aria-label={label}>
      <p className="presets__row-label">{label}</p>
      <button
        type="button"
        className="presets__arrow"
        aria-label={previousLabel}
        onClick={() => step(-1)}
      >
        <Chevron direction="left" />
      </button>
      <div className="presets__window">{shown.map((i) => render(i))}</div>
      <button
        type="button"
        className="presets__arrow"
        aria-label={nextLabel}
        onClick={() => step(1)}
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

/** The arrow on a strip's end. Drawn, like the rest of the set, so it is the
 *  same weight as everything else and takes its colour from the text. */
function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={direction === "left" ? "M15 5 L8 12 L15 19" : "M9 5 L16 12 L9 19"}
      />
    </svg>
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
