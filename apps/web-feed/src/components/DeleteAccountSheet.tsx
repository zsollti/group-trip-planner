import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { ApiError, useAuth, useDeletionPreview } from "@gtp/api-client";

/**
 * Feed-paradigm account-deletion surface: a bottom sheet raised from the Profile
 * tab. Shows the deletion impact (SRS FR-6) — which trips change hands, which are
 * wiped — and requires a deliberate confirm. On success the session is gone, so
 * it routes to sign-in.
 */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { deleteAccount } = useAuth();
  const preview = useDeletionPreview();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const impact = preview.data;
  const nothingOwned =
    impact && impact.transfers.length === 0 && impact.deletions.length === 0;

  async function onConfirm() {
    setFormError(null);
    setSubmitting(true);
    try {
      await deleteAccount();
      navigate("/login", { replace: true });
    } catch (err) {
      setSubmitting(false);
      setFormError(
        err instanceof ApiError
          ? err.message
          : "Could not delete your account. Try again.",
      );
    }
  }

  return (
    <div className="feed__sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feed__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Delete account"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feed__sheet-grip" aria-hidden="true" />
        <p className="feed__eyebrow">Danger zone</p>
        <h2 className="feed__title">Delete your account</h2>

        {preview.isPending ? (
          <p className="feed__muted">Checking what this affects…</p>
        ) : preview.isError ? (
          <p className="feed__form-error" role="alert">
            Couldn't load the impact.{" "}
            <button
              type="button"
              className="feed__link-btn"
              onClick={() => void preview.refetch()}
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            <p className="feed__muted">
              This permanently deletes your account and personal data. It can't
              be undone.
            </p>
            {nothingOwned ? (
              <p className="feed__muted">You don't own any trips.</p>
            ) : (
              <div className="feed__impact" aria-label="Deletion impact">
                {impact!.transfers.map((t) => (
                  <div key={t.tripId} className="feed__card">
                    <p className="feed__card-body">
                      <strong>{t.tripName}</strong> — ownership transfers to{" "}
                      {t.successorDisplayName}.
                    </p>
                  </div>
                ))}
                {impact!.deletions.map((d) => (
                  <div key={d.tripId} className="feed__card">
                    <p className="feed__card-body">
                      <strong>{d.tripName}</strong> will be permanently deleted
                      (you're its only member).
                    </p>
                  </div>
                ))}
              </div>
            )}
            {formError ? (
              <p className="feed__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="feed__wizard-nav">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => void onConfirm()}
              >
                {submitting ? "Deleting…" : "Delete my account"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
