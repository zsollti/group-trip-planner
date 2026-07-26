import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  useBoardLiveSync,
  useDeleteTrip,
  useTrip,
  useTripCategories,
  useTripSocket,
} from "@gtp/api-client";
import { can, type TripDetail as TripDetailData } from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { useAuth } from "@gtp/api-client";
import { EditBoardDialog } from "../components/EditBoardDialog";
import { InviteDialog } from "../components/InviteDialog";
import { MemberDialog } from "../components/MemberDialog";
import { DeleteAccountDialog } from "../components/DeleteAccountDialog";
import { BoardCanvas } from "../components/BoardCanvas";
import { Menu, type MenuItem } from "../components/Menu";
import { UserMenu } from "../components/UserMenu";
import { LiveIndicator } from "../components/LiveIndicator";
import { NotificationBell } from "../components/NotificationBell";
import { ChatPanel } from "../components/ChatPanel";

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A channel a lane's "Discuss" action asked the chat panel to open (null = idle).
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const categories = useTripCategories(id);
  // One trip socket for the whole screen, shared by the live indicator + chat.
  const tripSocket = useTripSocket(id);
  // Keep the board live: refetch lanes/cost when anyone proposes, votes, or an
  // organizer locks/unlocks — pushed over the same socket (Phase 4.5 retrofit).
  useBoardLiveSync(tripSocket.socket, id);

  // Escape closes the delete-confirmation dialog (its backdrop no longer
  // dismisses, so this is the keyboard path alongside Cancel). Phase 3.5 a11y.
  useEffect(() => {
    if (!confirmingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmingDelete(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingDelete]);

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

  /** The trip "⋯" menu — Members (any member) + Edit/Delete (role-gated). */
  function tripMenuItems(role: TripDetailData["role"]): MenuItem[] {
    const items: MenuItem[] = [
      { label: "Members", onSelect: () => setManagingMembers(true) },
    ];
    if (can(role, "trip.edit")) {
      items.push({ label: "Edit trip", onSelect: () => setEditing(true) });
    }
    if (can(role, "trip.delete")) {
      items.push({
        label: "Delete trip",
        onSelect: () => setConfirmingDelete(true),
        danger: true,
      });
    }
    return items;
  }

  return (
    <main className="board">
      <header className="board__bar">
        <Link className="board__brand board__brand--link" to="/">
          ‹ Boards
        </Link>
        <div className="board__bar-actions">
          {trip.data ? <LiveIndicator status={tripSocket.status} /> : null}
          {/* The socket's personal room carries notifications for every trip the
              user belongs to, not just this one (Phase 5.1, decision 1). */}
          <NotificationBell socket={tripSocket.socket} />
          {trip.data && can(trip.data.role, "invite.create") ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setInviting(true)}
            >
              Invite
            </Button>
          ) : null}
          {trip.data ? (
            <Menu label="Trip menu" items={tripMenuItems(trip.data.role)} />
          ) : null}
          <UserMenu onDeleteAccount={() => setDeleteAccountOpen(true)} />
        </div>
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
          {trip.data.status === "HISTORY" ? (
            <p className="board__frozen" role="status">
              This board has ended — it's now read-only. Proposing, dot-voting,
              and locking are closed.
            </p>
          ) : null}

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
            <BoardCanvas
              tripId={trip.data.id}
              categories={categories.data}
              defaultCurrency={trip.data.defaultCurrency}
              myRole={trip.data.role}
              myUserId={user?.id}
              frozen={trip.data.status === "HISTORY"}
              onOpenChannel={setOpenChannelId}
            />
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

          {deleteAccountOpen ? (
            <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
          ) : null}

          <ChatPanel
            tripId={trip.data.id}
            tripSocket={tripSocket}
            categories={categories.data ?? []}
            myRole={trip.data.role}
            myUserId={user?.id}
            requestChannelId={openChannelId}
            onRequestHandled={() => setOpenChannelId(null)}
          />

          {confirmingDelete ? (
            <div className="board__backdrop" role="presentation">
              <div
                className="board__dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Delete board"
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
                    autoFocus
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
