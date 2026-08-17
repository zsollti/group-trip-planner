import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@gtp/ui-primitives";
import { ApiError, useAuth, useDeletionPreview } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { t } from "../lib/i18n";

/**
 * Board-paradigm account-deletion surface: a card floating on the canvas. Shows
 * the deletion impact (SRS FR-6) — which boards change hands, which are wiped —
 * and requires a deliberate confirm. On success the session is gone, so it routes
 * to sign-in.
 */
export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { deleteAccount } = useAuth();
  const preview = useDeletionPreview();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    <Dialog
      eyebrow="Danger zone"
      title={t("Delete your account")}
      onClose={onClose}
    >
      <>
        {preview.isPending ? (
          <p className="board__muted" role="status">
            {t("Checking what this affects…")}
          </p>
        ) : preview.isError ? (
          <p className="board__form-error" role="alert">
            Couldn't load the impact.{" "}
            <button
              type="button"
              className="board__link-btn"
              onClick={() => void preview.refetch()}
            >
              {t("Retry")}
            </button>
          </p>
        ) : (
          <>
            <p className="board__muted">
              {t(
                "This permanently deletes your account and personal data. It can't be undone.",
              )}
            </p>
            {nothingOwned ? (
              <p className="board__muted">{t("You don't own any boards.")}</p>
            ) : (
              <div className="board__impact" aria-label={t("Deletion impact")}>
                {impact!.transfers.length > 0 ? (
                  <>
                    <p className="board__eyebrow">
                      Ownership transfers ({impact!.transfers.length})
                    </p>
                    <ul className="board__impact-list">
                      {impact!.transfers.map((t) => (
                        <li key={t.tripId}>
                          <strong>{t.tripName}</strong> →{" "}
                          {t.successorDisplayName}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {impact!.deletions.length > 0 ? (
                  <>
                    <p className="board__eyebrow">
                      Permanently deleted ({impact!.deletions.length})
                    </p>
                    <ul className="board__impact-list">
                      {impact!.deletions.map((d) => (
                        <li key={d.tripId}>
                          <strong>{d.tripName}</strong> — you're the only member
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
            {formError ? (
              <p className="board__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="board__dialog-actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("Cancel")}
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
      </>
    </Dialog>
  );
}
