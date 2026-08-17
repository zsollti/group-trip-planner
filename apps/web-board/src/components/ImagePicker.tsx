import { useEffect, useRef, useState } from "react";
import { Button } from "@gtp/ui-primitives";
import { t } from "../lib/i18n";

/** Mirrors the server's allowlist so the file dialog offers the right filter.
 *  The server still decides — this only saves an obvious round-trip. */
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Choose an image, see it, then commit (Phase 6.2). Shared by the avatar and
 * trip-cover flows so both behave the same way.
 *
 * The preview is a local object URL, so it costs no upload: nothing is sent
 * until "Save", and picking a different file before then simply replaces what
 * you are looking at. That matters because uploading is the expensive,
 * rate-limited operation — a preview that uploaded first would burn budget on
 * pictures the user was only trying out.
 */
export function ImagePicker({
  label,
  shape = "square",
  currentUrl,
  busy = false,
  error,
  onSave,
  onRemove,
}: {
  label: string;
  /** How to frame the preview — a round avatar or a wide cover strip. */
  shape?: "square" | "wide";
  currentUrl: string | null;
  busy?: boolean;
  error?: string | null;
  onSave: (file: File) => void;
  onRemove?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  const shown = previewUrl ?? currentUrl;

  return (
    <div className="picker">
      <p className="picker__label">{label}</p>

      <div className={`picker__frame picker__frame--${shape}`}>
        {shown ? (
          <img className="picker__preview" src={shown} alt="" />
        ) : (
          <span className="picker__empty">{t("No image yet")}</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="picker__input"
        accept={ACCEPT}
        aria-label={t("{label} — choose a file", { label })}
        onChange={(e) => setPending(e.target.files?.[0] ?? null)}
      />

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="picker__actions">
        {pending ? (
          <>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => onSave(pending)}
            >
              {busy ? "Uploading…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              {t("Cancel")}
            </Button>
          </>
        ) : currentUrl && onRemove ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onRemove}
          >
            {busy ? "Removing…" : "Remove"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
