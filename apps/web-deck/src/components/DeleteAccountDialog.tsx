import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { ApiError, useAuth, useDeletionPreview } from "@gtp/api-client";

/**
 * Deck-paradigm account-deletion surface: a console modal launched from the
 * command palette. It fetches the deletion impact (SRS FR-6) and makes the user
 * acknowledge exactly what happens — which trips change hands, which are wiped —
 * before the irreversible confirm. On success the session is already torn down,
 * so it routes to the sign-in screen.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
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
    <div className="deck__palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="deck__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete account"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="deck__eyebrow">Danger zone</p>
        <h2 className="deck__dialog-title">Delete your account</h2>

        {preview.isPending ? (
          <p className="deck__lede">Checking what this affects…</p>
        ) : preview.isError ? (
          <p className="deck__form-error" role="alert">
            Couldn't load the impact.{" "}
            <button
              type="button"
              className="deck__link-btn"
              onClick={() => void preview.refetch()}
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            <p className="deck__lede">
              This permanently deletes your account and personal data. It can't
              be undone.
            </p>
            {nothingOwned ? (
              <p className="deck__lede">You don't own any trips.</p>
            ) : (
              <div className="deck__impact" aria-label="Deletion impact">
                {impact!.transfers.length > 0 ? (
                  <>
                    <p className="deck__eyebrow">
                      Ownership transfers ({impact!.transfers.length})
                    </p>
                    <ul className="deck__manifest">
                      {impact!.transfers.map((t) => (
                        <li key={t.tripId} className="deck__impact-row">
                          <span className="deck__row-name">{t.tripName}</span>
                          <span className="deck__row-meta">
                            → {t.successorDisplayName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {impact!.deletions.length > 0 ? (
                  <>
                    <p className="deck__eyebrow">
                      Permanently deleted ({impact!.deletions.length})
                    </p>
                    <ul className="deck__manifest">
                      {impact!.deletions.map((d) => (
                        <li key={d.tripId} className="deck__impact-row">
                          <span className="deck__row-name">{d.tripName}</span>
                          <span className="deck__row-meta">
                            you're the only member
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
            {formError ? (
              <p className="deck__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="deck__dialog-actions">
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
