import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, useDeleteTrip, useTrip } from "@gtp/api-client";
import { can, type TripDetail as TripDetailData } from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { EditTripSheet } from "../components/EditTripSheet";
import { InviteSheet } from "../components/InviteSheet";
import { MemberSheet } from "../components/MemberSheet";

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
 * Trip screen shell (Phase 1.1). Planning surfaces arrive in later phases; for
 * now it shows the trip's identity + the caller's role, plus role-gated
 * edit/delete controls (Phase 1.2) driven by the shared `can`.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const trip = useTrip(id);
  const deleteTrip = useDeleteTrip(id ?? "");
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
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
    <div className="feed">
      <header className="feed__topbar">
        <Link className="feed__back" to="/" aria-label="Back to home">
          ‹ Home
        </Link>
      </header>
      <main className="feed__screen">
        {trip.isPending ? (
          <p className="feed__muted">Loading trip…</p>
        ) : trip.isError ? (
          <div className="feed__card">
            <div className="feed__card-media">🚫</div>
            <p className="feed__card-body">
              {trip.error.status === 404
                ? "That trip doesn't exist or you're not a member."
                : "Couldn't load this trip."}
            </p>
            <div className="feed__card-cta">
              <Link className="feed__alt" to="/">
                Back to home
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="feed__eyebrow">
              {trip.data.status === "HISTORY" ? "History" : "Active trip"} ·{" "}
              {ROLE_LABEL[trip.data.role]}
            </p>
            <h1 className="feed__title">{trip.data.name}</h1>
            {trip.data.description ? (
              <p className="feed__muted">{trip.data.description}</p>
            ) : null}
            <div className="feed__card">
              <dl className="feed__facts">
                <div>
                  <dt>Destination</dt>
                  <dd>{trip.data.destination ?? "—"}</dd>
                </div>
                <div>
                  <dt>Dates</dt>
                  <dd>
                    {fmtDate(trip.data.startDate)} –{" "}
                    {fmtDate(trip.data.endDate)}
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
            </div>
            <div className="feed__card">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setManagingMembers(true)}
              >
                Members
              </Button>
              {can(trip.data.role, "invite.create") ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setInviting(true)}
                >
                  Invite people
                </Button>
              ) : null}
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
            {actionError ? (
              <p className="feed__form-error" role="alert">
                {actionError}
              </p>
            ) : null}

            <p className="feed__muted">
              Categories, options, voting and the cost view land in the next
              phases.
            </p>

            {editing ? (
              <EditTripSheet
                trip={trip.data}
                onClose={() => setEditing(false)}
              />
            ) : null}

            {inviting ? (
              <InviteSheet
                tripId={trip.data.id}
                myRole={trip.data.role}
                onClose={() => setInviting(false)}
              />
            ) : null}

            {managingMembers ? (
              <MemberSheet
                tripId={trip.data.id}
                myRole={trip.data.role}
                onClose={() => setManagingMembers(false)}
              />
            ) : null}

            {confirmingDelete ? (
              <div
                className="feed__sheet-backdrop"
                role="presentation"
                onClick={() => setConfirmingDelete(false)}
              >
                <div
                  className="feed__sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Delete trip"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="feed__sheet-grip" aria-hidden="true" />
                  <p className="feed__eyebrow">Delete trip</p>
                  <h2 className="feed__title">Delete “{trip.data.name}”?</h2>
                  <p className="feed__muted">
                    This permanently removes the trip for everyone. This can't
                    be undone.
                  </p>
                  <div className="feed__wizard-nav">
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
      </main>
    </div>
  );
}
