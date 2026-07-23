import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  useDeleteTrip,
  useTrip,
  useTripCategories,
} from "@gtp/api-client";
import { can, type TripDetail as TripDetailData } from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { useAuth } from "@gtp/api-client";
import { EditBoardDialog } from "../components/EditBoardDialog";
import { InviteDialog } from "../components/InviteDialog";
import { MemberDialog } from "../components/MemberDialog";
import { CategoryManager } from "../components/CategoryManager";
import { CategoryLane } from "../components/CategoryLane";

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
 * A single trip board shell (Phase 1.1). Shows the trip identity + a preview of
 * the category lanes; proposing, dot-voting and drag-to-Decided arrive later.
 */
export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const trip = useTrip(id);
  const deleteTrip = useDeleteTrip(id ?? "");
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const categories = useTripCategories(id);

  async function onDelete() {
    setActionError(null);
    try {
      await deleteTrip.mutateAsync();
      navigate("/");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Could not delete the board",
      );
    }
  }

  return (
    <main className="board">
      <header className="board__bar">
        <Link className="board__brand board__brand--link" to="/">
          ‹ Boards
        </Link>
      </header>

      {trip.isPending ? (
        <p className="board__muted">Loading board…</p>
      ) : trip.isError ? (
        <>
          <p className="board__form-error" role="alert">
            {trip.error.status === 404
              ? "That board doesn't exist or you're not a member."
              : "Couldn't load this board."}
          </p>
          <Link className="board__cta" to="/">
            Back to boards
          </Link>
        </>
      ) : (
        <>
          <p className="board__eyebrow">
            {trip.data.status === "HISTORY" ? "History" : "Active"} ·{" "}
            {ROLE_LABEL[trip.data.role]}
          </p>
          <h1 className="board__title">{trip.data.name}</h1>
          <p className="board__muted">
            {trip.data.destination ?? "No destination yet"} ·{" "}
            {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)} ·{" "}
            {trip.data.memberCount} member
            {trip.data.memberCount === 1 ? "" : "s"} ·{" "}
            {trip.data.defaultCurrency}
          </p>

          <div className="board__dialog-actions">
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
                variant="secondary"
                onClick={() => setInviting(true)}
              >
                Invite
              </Button>
            ) : null}
            {can(trip.data.role, "category.manage") ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setManagingCategories(true)}
              >
                Categories
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
            <p className="board__form-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {categories.isPending ? (
            <p className="board__muted">Loading lanes…</p>
          ) : categories.isError ? (
            <p className="board__muted">Couldn't load the category lanes.</p>
          ) : (
            <div className="board__canvas" aria-label="Category lanes">
              {categories.data.map((cat) => (
                <CategoryLane
                  key={cat.id}
                  tripId={trip.data.id}
                  category={cat}
                  defaultCurrency={trip.data.defaultCurrency}
                  myRole={trip.data.role}
                  myUserId={user?.id}
                />
              ))}
              <section className="lane lane--decided">
                <h2 className="lane__title">✦ Decided</h2>
                <div className="lane__card lane__card--ghost">
                  Locked picks land here
                </div>
              </section>
            </div>
          )}

          {editing ? (
            <EditBoardDialog
              trip={trip.data}
              onClose={() => setEditing(false)}
            />
          ) : null}

          {inviting ? (
            <InviteDialog
              tripId={trip.data.id}
              myRole={trip.data.role}
              onClose={() => setInviting(false)}
            />
          ) : null}

          {managingMembers ? (
            <MemberDialog
              tripId={trip.data.id}
              myRole={trip.data.role}
              onClose={() => setManagingMembers(false)}
            />
          ) : null}

          {managingCategories ? (
            <CategoryManager
              tripId={trip.data.id}
              onClose={() => setManagingCategories(false)}
            />
          ) : null}

          {confirmingDelete ? (
            <div
              className="board__backdrop"
              role="presentation"
              onClick={() => setConfirmingDelete(false)}
            >
              <div
                className="board__dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Delete board"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="board__eyebrow">Delete board</p>
                <h2 className="board__title">Delete “{trip.data.name}”?</h2>
                <p className="board__muted">
                  This permanently removes the board and its membership for
                  everyone. This can't be undone.
                </p>
                <div className="board__dialog-actions">
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
                    {deleteTrip.isPending ? "Deleting…" : "Delete board"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
