import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, useDeleteTrip, useTrip } from "@gtp/api-client";
import { can, type TripDetail as TripDetailData } from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { EditTripDialog } from "../components/EditTripDialog";

const ROLE_LABEL: Record<TripDetailData["role"], string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

/**
 * Trip console shell (Phase 1.1). Categories, options, and the ledger arrive in
 * later phases; for now it surfaces the trip's identity + the caller's role,
 * plus role-gated edit/delete controls (Phase 1.2) driven by the shared `can`.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const trip = useTrip(id);
  const deleteTrip = useDeleteTrip(id ?? "");
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onDelete() {
    setActionError(null);
    try {
      await deleteTrip.mutateAsync();
      navigate("/");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Could not delete the trip",
      );
    }
  }

  return (
    <main className="deck">
      <header className="deck__bar">
        <Link className="deck__brand deck__brand--link" to="/">
          ← COMMAND DECK
        </Link>
      </header>

      <section className="deck__body">
        {trip.isPending ? (
          <p className="deck__lede">Loading trip…</p>
        ) : trip.isError ? (
          <div className="deck__empty">
            <p className="deck__form-error" role="alert">
              {trip.error.status === 404
                ? "That trip doesn't exist or you're not a member."
                : "Couldn't load this trip."}
            </p>
            <Link className="deck__cta" to="/">
              Back to deck
            </Link>
          </div>
        ) : (
          <>
            <div className="deck__manifest-head">
              <p className="deck__eyebrow">
                {trip.data.status === "HISTORY" ? "History" : "Active trip"}
              </p>
              <span className="deck__badge">{ROLE_LABEL[trip.data.role]}</span>
            </div>
            <h1 className="deck__title">{trip.data.name}</h1>
            {can(trip.data.role, "trip.edit") ||
            can(trip.data.role, "trip.delete") ? (
              <div className="deck__dialog-actions">
                {can(trip.data.role, "trip.edit") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing(true)}
                  >
                    Edit trip
                  </Button>
                ) : null}
                {can(trip.data.role, "trip.delete") ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete trip
                  </Button>
                ) : null}
              </div>
            ) : null}
            {actionError ? (
              <p className="deck__form-error" role="alert">
                {actionError}
              </p>
            ) : null}
            {trip.data.description ? (
              <p className="deck__lede">{trip.data.description}</p>
            ) : null}
            <dl className="deck__facts">
              <div>
                <dt>Destination</dt>
                <dd>{trip.data.destination ?? "—"}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>
                  {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)}
                </dd>
              </div>
              <div>
                <dt>Members</dt>
                <dd>{trip.data.memberCount}</dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>{trip.data.defaultCurrency}</dd>
              </div>
            </dl>
            <p className="deck__muted">
              Planning surfaces (categories, options, voting, the cost ledger)
              land in the next phases.
            </p>

            {editing ? (
              <EditTripDialog
                trip={trip.data}
                onClose={() => setEditing(false)}
              />
            ) : null}

            {confirmingDelete ? (
              <div
                className="deck__palette-backdrop"
                role="presentation"
                onClick={() => setConfirmingDelete(false)}
              >
                <div
                  className="deck__dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Delete trip"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="deck__eyebrow">Delete trip</p>
                  <h2 className="deck__dialog-title">Delete “{trip.data.name}”?</h2>
                  <p className="deck__muted">
                    This permanently removes the trip and its membership for
                    everyone. This can't be undone.
                  </p>
                  <div className="deck__dialog-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={deleteTrip.isPending}
                      onClick={onDelete}
                    >
                      {deleteTrip.isPending ? "Deleting…" : "Delete trip"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
