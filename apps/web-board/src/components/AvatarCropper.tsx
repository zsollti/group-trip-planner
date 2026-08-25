import { useEffect, useRef, useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { Dialog } from "./Dialog";
import { t } from "../lib/i18n";

/** How wide the square we cut is, in pixels. Comfortably above the largest
 *  circle the app draws and well under the server's own cap, so this never
 *  *adds* pixels — it only chooses which ones to keep. */
const OUTPUT_PX = 512;

/** The frame the reader drags under, in CSS pixels. */
const VIEWPORT_PX = 260;

/** Zoom bounds, as a multiple of "just covers the circle". */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * Choose which circle of a picture is the avatar.
 *
 * Uploading used to mean handing over whatever the camera framed and hoping the
 * middle of it was your face. The server's resize is `fit: "inside"`, so a
 * portrait came back whole and was then drawn inside a circle by CSS — which
 * crops it, silently, to the middle. Anyone whose head was not in the middle of
 * the frame got a picture of their shoulder.
 *
 * So the cut is made **here**, before the upload: pan and zoom under a fixed
 * circular window, and what is sent is the square that window sits on. The
 * server pipeline is untouched — it still re-encodes and caps whatever it is
 * given, and it is still the thing that decides what is acceptable. This only
 * decides what to send it, which also means a 6MB photograph now arrives as a
 * 512px square instead of arguing with the size limit.
 *
 * The source is drawn at its natural resolution into an off-screen canvas, so
 * the result is as sharp as the picture allows rather than as sharp as the
 * 260px frame the reader was looking at.
 */
export function AvatarCropper({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  /** The chosen circle, as a square PNG ready to upload. */
  onCropped: (cropped: File) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  // Where the centre of the picture sits relative to the centre of the window,
  // in viewport pixels. Stored rather than derived, so a drag is a plain add.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  // Decode once, from an object URL revoked as soon as the bitmap is in hand —
  // an <img> keeps its own decoded copy, so nothing is lost by letting the URL
  // go, and a picker used four times would otherwise leak four blobs.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => setError(t("That file couldn't be read as a picture."));
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /**
   * How many viewport pixels one source pixel takes at zoom 1.
   *
   * The **short** side is what fills the window, so the picture always covers
   * the circle and no zoom or drag can expose a corner of empty canvas. Every
   * other number here is in viewport pixels, so this is the one place the two
   * coordinate systems meet.
   */
  const baseScale = image
    ? VIEWPORT_PX / Math.min(image.naturalWidth, image.naturalHeight)
    : 1;
  const scale = baseScale * zoom;

  /** Keep the picture covering the window: the offset can never expose an edge. */
  function clamp(next: { x: number; y: number }, at: number = scale) {
    if (!image) return next;
    const slackX = Math.max(0, (image.naturalWidth * at - VIEWPORT_PX) / 2);
    const slackY = Math.max(0, (image.naturalHeight * at - VIEWPORT_PX) / 2);
    return {
      x: Math.min(slackX, Math.max(-slackX, next.x)),
      y: Math.min(slackY, Math.max(-slackY, next.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    dragFrom.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const from = dragFrom.current;
    if (!from) return;
    setOffset(clamp({ x: e.clientX - from.x, y: e.clientY - from.y }));
  }
  function onPointerUp() {
    dragFrom.current = null;
  }

  /** Nudge by keyboard, for anyone who is not dragging anything. */
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 20 : 5;
    const by: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = by[e.key];
    if (!delta) return;
    e.preventDefault();
    setOffset((o) => clamp({ x: o.x + delta.x, y: o.y + delta.y }));
  }

  /** Zooming out from a corner would leave the picture pulled off a window it
   *  has just stopped covering, so the offset is re-clamped at the new scale. */
  function changeZoom(next: number) {
    setZoom(next);
    setOffset((o) => clamp(o, baseScale * next));
  }

  function cut() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(t("That picture couldn't be cropped here. Try another one."));
      return;
    }
    // Draw the source so the viewport's centre lands on the canvas centre, at
    // OUTPUT_PX/VIEWPORT_PX times the on-screen scale. One transform rather
    // than working out a source rectangle: at high zoom that rectangle can fall
    // outside the image, and `drawImage` with an out-of-bounds source is a
    // silent no-op in some browsers and a throw in others.
    const out = OUTPUT_PX / VIEWPORT_PX;
    ctx.translate(
      OUTPUT_PX / 2 + offset.x * out,
      OUTPUT_PX / 2 + offset.y * out,
    );
    ctx.scale(scale * out, scale * out);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError(t("That picture couldn't be cropped here. Try another one."));
        return;
      }
      // A square PNG. The circle is drawn by CSS wherever an avatar appears, so
      // cutting a transparent disc here would only make every surface showing
      // it on a coloured background look like it had a hole in it.
      onCropped(new File([blob], "avatar.png", { type: "image/png" }));
    }, "image/png");
  }

  return (
    <Dialog title={t("Choose your circle")} onClose={onCancel}>
      <>
        <p className="board__panel-note">
          {t("Drag the picture to move it, and use the slider to zoom.")}
        </p>
        <div className="cropper">
          <div
            className="cropper__stage"
            style={{ width: VIEWPORT_PX, height: VIEWPORT_PX }}
            role="application"
            aria-label={t("Position your picture")}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {image ? (
              <img
                className="cropper__image"
                src={image.src}
                alt=""
                draggable={false}
                style={{
                  width: image.naturalWidth * scale,
                  height: image.naturalHeight * scale,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                }}
              />
            ) : null}
            {/* The circle is a hole cut in a cover over the picture, not a clip
                on the picture — so what falls outside stays visible and dimmed,
                which is what makes it obvious there is more to drag. */}
            <div className="cropper__mask" aria-hidden="true" />
          </div>
          <label className="cropper__zoom">
            <span className="board__sr-only">{t("Zoom")}</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!image}
              onChange={(e) => changeZoom(Number(e.target.value))}
            />
          </label>
        </div>
        {error ? (
          <p className="board__form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="board__dialog-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!image}
            onClick={cut}
          >
            {t("Save")}
          </Button>
        </div>
      </>
    </Dialog>
  );
}
