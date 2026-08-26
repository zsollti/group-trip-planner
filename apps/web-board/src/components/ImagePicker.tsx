import { useEffect, useRef, useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { AvatarCropper } from "./AvatarCropper";
import { t } from "../lib/i18n";

/** Mirrors the server's allowlist so the file dialog offers the right filter.
 *  The server still decides — this only saves an obvious round-trip. */
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Choose an image, see it, then commit (Phase 6.2). Shared by the avatar and
 * trip-cover flows so both behave the same way.
 *
 * The preview is a local object URL, so it costs no upload: nothing is sent
 * until the pick is committed, and picking a different file before then simply
 * replaces what you are looking at. That matters because uploading is the
 * expensive, rate-limited operation — a preview that uploaded first would burn
 * budget on pictures the user was only trying out.
 *
 * **The circle is chosen, where there is one.** With `cropCircle`, a picked file
 * goes through {@link AvatarCropper} before it becomes the pending pick, so what
 * is previewed and what is uploaded are both the square the reader framed. The
 * trip cover does not ask for it: a cover is drawn as a wide strip and is not
 * cropped to a circle by anything, so there would be nothing to choose.
 *
 * **Two shapes, one component.** Given `onSave` it commits its own pick with its
 * own button, which is what the account page wants: the avatar panel is the only
 * thing on it, so its Save is the page's Save. Given `onPick` instead, it hands
 * the chosen file up and renders no commit button at all — for a picker that is
 * one field of a larger form, where a second Save beside the form's own is the
 * reader having to work out which button owns which input. The edit-trip dialog
 * had exactly that, and its own Save did not cover the cover.
 */
export function ImagePicker({
  label,
  shape = "square",
  currentUrl,
  busy = false,
  error,
  onSave,
  onPick,
  onRemove,
  removed = false,
  cropCircle = false,
  labelHidden = false,
  centred = false,
  framed = true,
}: {
  label: string;
  /** How to frame the preview — a round avatar or a wide cover strip. */
  shape?: "square" | "wide";
  currentUrl: string | null;
  busy?: boolean;
  error?: string | null;
  /** Commit the pick here and now, with a Save of this picker's own. */
  onSave?: (file: File) => void;
  /**
   * Hand the pick to the surrounding form instead, which commits it with
   * everything else. `null` means the reader took their pick back.
   */
  onPick?: (file: File | null) => void;
  onRemove?: () => void;
  /** In `onPick` mode: the existing image is staged for removal on save. */
  removed?: boolean;
  /** Let the reader choose which circle of the picture this is. */
  cropCircle?: boolean;
  /**
   * Take the label off the screen and leave it to assistive technology.
   *
   * Never a way to drop it: `label` is also what names the file input
   * (`"{label} — choose a file"`), which is the control a voice user asks for
   * by name, so the string still has to be here and still has to be right. For
   * the case where the panel's own heading directly above already says it —
   * "Profile picture", then "Your picture" underneath — which is two names for
   * one thing and the reader has to read both to find out they are the same.
   */
  labelHidden?: boolean;
  /** Centre the frame and its controls in the panel, for a picker that is the
   *  whole of what a panel is about rather than one field of a form. */
  centred?: boolean;
  /**
   * Draw the preview frame, or leave it to the caller.
   *
   * The account page shows *one* picture — whatever the reader is actually
   * wearing, photograph or drawn mark — and this picker only knows about half
   * of that. Two frames side by side, one of them saying "No image yet" to
   * somebody who plainly has an image, was the panel asking its own question
   * twice. So there the frame belongs to {@link AvatarField} and this keeps the
   * part that is genuinely its own: choosing a file, framing it, removing it.
   */
  framed?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // A file chosen but not yet framed. Deliberately not `pending`: nothing is
  // previewed or committed until the reader has said which circle they meant.
  const [cropping, setCropping] = useState<File | null>(null);

  // Object URLs are a manual resource: revoke the old one whenever the pick
  // changes or the component goes away, or the page leaks a blob per attempt.
  useEffect(() => {
    if (!pending) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pending);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  // A staged removal has to show as gone, or the panel says "Remove" and then
  // carries on displaying the thing it is about to remove until you save.
  const shown = previewUrl ?? (removed ? null : currentUrl);

  function pick(file: File | null) {
    if (file && cropCircle) {
      setCropping(file);
      return;
    }
    setPending(file);
    onPick?.(file);
  }

  return (
    <div className={"picker" + (centred ? " picker--centred" : "")}>
      {cropping ? (
        <AvatarCropper
          file={cropping}
          onCancel={() => {
            setCropping(null);
            // Clear the input too, or choosing the same file again is a change
            // event the browser never fires and a picker that appears stuck.
            if (inputRef.current) inputRef.current.value = "";
          }}
          onCropped={(cropped) => {
            setCropping(null);
            // Where this picker owns the commit, framing the circle *is* the
            // commit. It used to stage the crop and then ask again — the
            // cropper said "Use this", you said yes, and the panel came back
            // with a Save and a Cancel to answer the same question a second
            // time. The cropper is already the preview, and it already has a
            // Cancel; a confirmation after a confirmation is not more caution,
            // it is a step the reader has to work out the purpose of.
            //
            // `onPick` mode keeps staging, because there the commit genuinely
            // belongs to somebody else: the surrounding form's own Save.
            if (onSave) {
              onSave(cropped);
              return;
            }
            setPending(cropped);
            onPick?.(cropped);
          }}
        />
      ) : null}
      <p className={"picker__label" + (labelHidden ? " board__sr-only" : "")}>
        {label}
      </p>

      {framed ? (
        <div className={`picker__frame picker__frame--${shape}`}>
          {shown ? (
            <img className="picker__preview" src={shown} alt="" />
          ) : (
            <span className="picker__empty">{t("No image yet")}</span>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* One row: pick, then whatever you can do with the pick. They were
          stacked — the file control was its own block above the buttons —
          so a panel with a picked file showed three controls down a column
          where they are three ways of answering one question. */}
      <div className="picker__actions">
        {/*
         * The file input, hidden inside a label that is dressed as a button.
         *
         * A bare `<input type="file">` renders the browser's own button, and that
         * button is two problems at once: it is unstyleable — it sat next to this
         * app's controls looking like nothing else on the page — and its text
         * comes from the *browser's* locale, not the app's, so a Hungarian Chrome
         * said "Fájl kiválasztása" on an English board and a "Tallózás…" on a
         * Hungarian one, neither of which this app chose or can translate.
         *
         * Wrapping it in a label is what lets us write the words ourselves: a
         * click anywhere on the label opens the picker, and the control stays a
         * real file input with its native semantics rather than a button
         * pretending. The input is clipped rather than `display: none`, so it is
         * still focusable and still announced — the ring is drawn on the label
         * via `:focus-within`, since the thing receiving focus is invisible.
         *
         * The visible words are a substring of the accessible name, so a voice
         * user asking for "choose a file" reaches the control the label names.
         */}
        <label className="picker__choose">
          <input
            ref={inputRef}
            type="file"
            className="picker__file"
            accept={ACCEPT}
            aria-label={t("{label} — choose a file", { label })}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <span aria-hidden="true">{t("Choose a file")}</span>
        </label>
        {pending ? (
          <>
            {/* Only where this picker owns its own commit. In `onPick` mode the
                form's single Save is the one button on the panel, which is the
                whole point of that mode. */}
            {onSave ? (
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => onSave(pending)}
              >
                {busy ? t("Uploading…") : t("Save")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                pick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              {t("Cancel")}
            </Button>
          </>
        ) : currentUrl && !removed && onRemove ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onRemove}
          >
            {busy ? t("Removing…") : t("Remove")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
