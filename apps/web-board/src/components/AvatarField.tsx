import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
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

/** How far a pan has to travel before it stops being a tap on a swatch. */
const PAN_SLOP = 4;

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
 * **Two sliders, side by side.** Twelve marks and eight colours as two full
 * grids was a wall of swatches on a settings page, so the strips used to show a
 * window of three and swap all three items on every arrow press. That is not
 * what an arrow beside a row of things means: it reads as "move along by one",
 * and a control that instead re-deals its whole contents gives a reader no way
 * to keep their place. Each strip is a real horizontal scroller now — drag it,
 * flick it, swipe two fingers across a touchpad, or press an arrow to slide it
 * along by exactly one swatch. Every colour and every mark is in the strip the
 * whole time; the box just shows the part of it you have scrolled to.
 *
 * The two sit together, with their labels above them, because they are the two
 * halves of one answer: a drawn avatar is a mark *and* a colour, and a reader
 * building one is going back and forth between them rather than finishing one
 * and moving on.
 *
 * **Two columns: what you are wearing, and what you can change it to.** The
 * panel used to read top to bottom — circle, file button, then the strips side
 * by side under them — which is a tall column on a settings page that has room
 * beside it, and it put the preview a scroll away from the strips that change
 * it. Now the circle and its file button hold the left, the two strips stack
 * down the right, and the thing you are changing stays level with the controls
 * that change it. It folds back to one column where two will not fit.
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
      {/* Across both columns, above everything: a failure belongs to the panel
          rather than to the half of it that happened to cause it. */}
      {error ? (
        <p className="board__form-error avatarfield__wide" role="alert">
          {error}
        </p>
      ) : null}

      {/* Left: what you are wearing, and the one control that replaces the
          whole thing with a photograph. */}
      <div className="avatarfield__current">
        {/* The one circle, drawn by `Avatar` from a composed value rather than
            by hand, so what this shows and what a crew list shows cannot
            drift. */}
        <div className="avatarfield__preview">
          <Avatar name={name} userId={userId} url={shown} size={96} />
        </div>

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
          // The circle is chosen before the upload: the server resizes to fit
          // and CSS then crops to the middle, so an off-centre face used to
          // become a picture of a shoulder.
          cropCircle
          onSave={onUpload}
          onRemove={onRemovePhoto}
        />
      </div>

      {/* Right: the two strips, stacked (see the note above) — two halves of
          one answer, each labelled over its own slider. */}
      <div className="presets">
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
                <AvatarPresetMark preset={preset} size={34} />
              </button>
            );
          }}
        />
      </div>

      {/* Only where it is true, and only for as long as it is. */}
      {!wornPreset && stagedColour ? (
        <p className="board__panel-note avatarfield__wide" role="status">
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
 * One labelled slider: an arrow, a scrolling strip of every item, an arrow.
 *
 * **It is a scroller, not a window into a list.** Every item is rendered and in
 * the box the whole time; what changes is where the box is scrolled to. That
 * costs nothing here — twenty small buttons between the two strips — and it
 * buys the three gestures a row of things is expected to answer to: a drag, a
 * two-finger swipe across a touchpad, and a flick on a phone, all of them the
 * browser's own scrolling rather than anything reimplemented here.
 *
 * The arrows move it **by one swatch**, measured off the items themselves
 * rather than from a constant, so the step stays right when the swatches change
 * size (a colour disc is smaller than a mark). The old strip re-dealt all three
 * of its items per press, which is the one thing an arrow beside a row does not
 * mean.
 *
 * **A drag is not a tap.** Panning with a mouse moves the strip under the
 * pointer, and the pointer is over a swatch the whole time — so a pan that
 * travels more than {@link PAN_SLOP} swallows the click it would otherwise end
 * with. Without that, letting go of a drag would silently change the reader's
 * avatar to whatever they happened to release over.
 *
 * It opens scrolled to the item being worn, so a reader whose mark is the
 * eleventh does not have to go looking for it to see it is theirs.
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
  /** Index of the item being worn, or -1. Decides where the strip opens. */
  currentIndex: number;
  previousLabel: string;
  nextLabel: string;
  render: (index: number) => React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  /** The pan in progress: where it started, and whether it has become a pan. */
  const pan = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  /** Set by a pan that moved, read and cleared by the click it has to swallow. */
  const panned = useRef(false);

  // Scrolled to the worn item on the first paint, before the browser shows the
  // strip at zero. `useLayoutEffect` rather than an effect for exactly that: in
  // an ordinary effect the first frame is drawn at the left end and the strip
  // visibly jumps. Runs once — re-running would drag the strip back under a
  // reader who had scrolled away from their own avatar.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || currentIndex < 0) return;
    const item = el.children[currentIndex];
    if (!(item instanceof HTMLElement)) return;
    el.scrollLeft = item.offsetLeft - (el.clientWidth - item.offsetWidth) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function step(by: number) {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft + by * itemPitch(el);
    // Guarded, and the guard is not defensive dressing: jsdom implements none
    // of the scroll methods, so a bare call would take every test of this field
    // down with it. Assigning `scrollLeft` is the same move without the easing.
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ left, behavior: "smooth" });
    } else {
      el.scrollLeft = left;
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    panned.current = false;
    // Touch is left to the browser: it already pans this box, with the inertia
    // and the rubber-banding the platform gives every other scroller.
    if (e.pointerType === "touch" || !scroller.current) return;
    pan.current = {
      x: e.clientX,
      from: scroller.current.scrollLeft,
      moved: false,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const started = pan.current;
    const el = scroller.current;
    if (!started || !el) return;
    const dx = e.clientX - started.x;
    if (!started.moved && Math.abs(dx) < PAN_SLOP) return;
    started.moved = true;
    panned.current = true;
    // Captured once the drag is real, so the strip keeps following a pointer
    // that has left the box — a pan that stopped dead at the edge of a control
    // this narrow would be unusable.
    el.setPointerCapture?.(e.pointerId);
    // Snapping is off for the length of the pan, and that is not a nicety: CSS
    // scroll snapping applies to programmatic scrolls too, so with `mandatory`
    // left on the line below is snapped back on every pointer move and the
    // strip never follows the pointer at all. Written straight onto the element
    // rather than through state — it lasts exactly as long as the gesture, and
    // a re-render per pointer move to carry a class would be the expensive way
    // to say the same thing.
    el.style.scrollSnapType = "none";
    el.scrollLeft = started.from - dx;
  }

  function endPan(e: ReactPointerEvent<HTMLDivElement>) {
    const el = scroller.current;
    if (pan.current?.moved && el) {
      el.releasePointerCapture?.(e.pointerId);
      // Back to the stylesheet's `mandatory`, which is what settles the strip on
      // a whole swatch after a pan that ended between two.
      el.style.scrollSnapType = "";
    }
    pan.current = null;
  }

  return (
    <div className="presets__row" role="group" aria-label={label}>
      <p className="presets__row-label">{label}</p>
      <div className="presets__track">
        <button
          type="button"
          className="presets__arrow"
          aria-label={previousLabel}
          onClick={() => step(-1)}
        >
          <Chevron direction="left" />
        </button>
        <div
          ref={scroller}
          className="presets__window"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          // Capture, so it runs before the swatch's own handler rather than
          // after it — by the bubble phase the avatar would already have changed.
          onClickCapture={(e) => {
            if (!panned.current) return;
            panned.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {Array.from({ length: count }, (_, i) => render(i))}
        </div>
        <button
          type="button"
          className="presets__arrow"
          aria-label={nextLabel}
          onClick={() => step(1)}
        >
          <Chevron direction="right" />
        </button>
      </div>
    </div>
  );
}

/**
 * How far one swatch is from the next, in pixels.
 *
 * Taken from the gap between the first two items where there are two, which
 * counts the flex gap without having to know it; from the item's own width
 * otherwise. Zero on a strip that has not been laid out, which is what makes
 * the arrows no-ops in jsdom rather than a crash.
 */
function itemPitch(el: HTMLElement): number {
  const first = el.firstElementChild;
  if (!(first instanceof HTMLElement)) return 0;
  const second = first.nextElementSibling;
  const pitch =
    second instanceof HTMLElement ? second.offsetLeft - first.offsetLeft : 0;
  return pitch > 0 ? pitch : first.offsetWidth;
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
