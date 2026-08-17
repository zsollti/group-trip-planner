import { useState } from "react";
import { intlTag } from "../lib/locale";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  useBoardLiveSync,
  useDeleteTrip,
  useSetTripMute,
  useTrip,
  useTripCategories,
  useTripSocket,
} from "@gtp/api-client";
import {
  can,
  tripDateRange,
  type TripDetail as TripDetailData,
} from "@gtp/types";
import { Button } from "@gtp/ui-primitives";
import { useAuth } from "@gtp/api-client";
import { EditBoardDialog } from "../components/EditBoardDialog";
import { InviteDialog } from "../components/InviteDialog";
import { MemberDialog } from "../components/MemberDialog";
import { ActivityDialog } from "../components/ActivityDialog";
import { BoardCanvas } from "../components/BoardCanvas";
import { Menu, type MenuItem } from "../components/Menu";
import { UserMenu } from "../components/UserMenu";
import { LiveIndicator } from "../components/LiveIndicator";
import { NotificationToasts } from "../components/NotificationToasts";
import { ChatPanel } from "../components/ChatPanel";
import { Dialog } from "../components/Dialog";
import { tripDateForDisplay } from "../lib/tripDate";
import { plural, t } from "../lib/i18n";
import { roleLabel } from "../lib/roles";

/**
 * A trip's own date, which is a calendar day rather than an instant — so it
 * goes through {@link tripDateForDisplay} instead of being formatted directly.
 * `new Date(iso).toLocaleDateString()` on a `date` column renders the day
 * before across the Americas.
 */
function fmtDate(iso: string | null): string {
  const d = tripDateForDisplay(iso);
  return d ? d.toLocaleDateString(intlTag()) : "—";
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
  const setMute = useSetTripMute(id ?? "");
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [viewingActivity, setViewingActivity] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A channel a lane's "Discuss" action asked the chat panel to open (null = idle).
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const categories = useTripCategories(id);
  // One trip socket for the whole screen, shared by the live indicator + chat.
  const tripSocket = useTripSocket(id);
  // Keep the board live: refetch lanes/cost when anyone proposes, votes, or an
  // organizer locks/unlocks — pushed over the same socket (Phase 4.5 retrofit).
  useBoardLiveSync(tripSocket.socket, id);

  async function onDelete() {
    setActionError(null);
    try {
      await deleteTrip.mutateAsync();
      navigate("/");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t("Could not delete the board"),
      );
    }
  }

  /**
   * Mute or unmute this board's notification email for the caller (Phase 5.3).
   * Every member may do it — it edits their own membership, nobody else's.
   */
  async function onToggleMute(muted: boolean) {
    setActionError(null);
    try {
      await setMute.mutateAsync(muted);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t("Could not change email for this board"),
      );
    }
  }

  /**
   * The trip "⋯" menu — Members + mute (any member) + Edit/Delete (role-gated).
   */
  function tripMenuItems(trip_: TripDetailData): MenuItem[] {
    const role = trip_.role;
    const items: MenuItem[] = [
      { label: t("Members"), onSelect: () => setManagingMembers(true) },
      { label: t("Activity"), onSelect: () => setViewingActivity(true) },
      {
        label: trip_.viewerMuted ? t("🔔 Unmute email") : t("🔕 Mute email"),
        onSelect: () => void onToggleMute(!trip_.viewerMuted),
      },
    ];
    if (can(role, "trip.edit")) {
      items.push({ label: t("Edit trip"), onSelect: () => setEditing(true) });
    }
    if (can(role, "trip.delete")) {
      items.push({
        label: t("Delete trip"),
        onSelect: () => setConfirmingDelete(true),
        danger: true,
      });
    }
    return items;
  }

  return (
    <main className="board">
      {/*
       * The socket's state, published but not drawn.
       *
       * It used to be legible only as the word "Live" in the corner, so
       * removing that badge would have taken the machine-readable signal with
       * it — and something does read it: the reconnect journey waits for *both*
       * browsers to be in the trip room before it sends the message it later
       * asserts on, which is the difference between testing recovery and
       * testing a race. The state exists either way; this is the seam that
       * keeps it observable without spending a corner of the header on it.
       */}
      <header className="board__bar" data-socket-status={tripSocket.status}>
        <Link className="board__brand board__brand--link" to="/">
          {t("‹ Boards")}
        </Link>
        <div className="board__bar-actions">
          {trip.data ? <LiveIndicator status={tripSocket.status} /> : null}
          {/* Only the toasts sit here now — the list itself is in the account
              menu. The socket's personal room carries notifications for every
              trip the user belongs to, not just this one (Phase 5.1,
              decision 1). */}
          <NotificationToasts socket={tripSocket.socket} />
          {/* Every member, and deliberately not role-gated: reading what the
              trip turned out to be is not an organizer's privilege. */}
          {trip.data ? (
            <Link
              className="board__timeline-link"
              to={`/trips/${trip.data.id}/timeline`}
            >
              {t("Timeline")}
            </Link>
          ) : null}
          {/* Invite used to sit here. It is in the crew panel now, beside the
              list of who is already on the trip — the header was a screen away
              from the only thing inviting changes. */}
          {trip.data ? (
            <Menu label={t("Trip menu")} items={tripMenuItems(trip.data)} />
          ) : null}
          <UserMenu />
        </div>
      </header>

      {trip.isPending ? (
        <p className="board__muted">{t("Loading board…")}</p>
      ) : trip.isError ? (
        <>
          <p className="board__form-error" role="alert">
            {trip.error.status === 404
              ? t("That board doesn't exist or you're not a member.")
              : t("Couldn't load this board.")}
          </p>
          <Link className="board__cta" to="/">
            {t("Back to boards")}
          </Link>
        </>
      ) : (
        <>
          <p className="board__eyebrow">
            {trip.data.status === "HISTORY" ? t("History") : t("Active")} ·{" "}
            {roleLabel(trip.data.role)}
            {/* Muting is invisible by nature — say so, or people forget they
                did it and wonder why the inbox is quiet (Phase 5.3). */}
            {trip.data.viewerMuted ? (
              <span className="board__mutedflag"> {t("· 🔕 Email muted")}</span>
            ) : null}
          </p>
          <h1 className="board__title">{trip.data.name}</h1>
          {/* Decorative: the trip's name and destination are right here in
              text, so the cover adds atmosphere, not information. */}
          {trip.data.coverImageUrl ? (
            <img
              className="board__cover"
              src={trip.data.coverImageUrl}
              alt=""
            />
          ) : null}
          <p className="board__muted">
            {trip.data.destination ?? t("No destination yet")} ·{" "}
            {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)} ·{" "}
            {plural(trip.data.memberCount, "{n} member", "{n} members")} ·{" "}
            {trip.data.defaultCurrency}
          </p>
          {trip.data.status === "HISTORY" ? (
            <p className="board__frozen" role="status">
              {t(
                "This board has ended — it's now read-only. Proposing, dot-voting, and locking are closed.",
              )}
            </p>
          ) : null}

          {actionError ? (
            <p className="board__form-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {categories.isPending ? (
            <p className="board__muted" role="status">
              {t("Loading lanes…")}
            </p>
          ) : categories.isError ? (
            /* Was a muted line with no way out: the lanes ARE the board, so a
               failure here empties the screen. Announce it and offer a retry. */
            <>
              <p className="board__form-error" role="alert">
                {t("Couldn't load the category lanes.")}
              </p>
              <button
                type="button"
                className="board__cta"
                onClick={() => void categories.refetch()}
              >
                {t("Try again")}
              </button>
            </>
          ) : (
            <BoardCanvas
              tripId={trip.data.id}
              categories={categories.data}
              defaultCurrency={trip.data.defaultCurrency}
              myRole={trip.data.role}
              myUserId={user?.id}
              frozen={trip.data.status === "HISTORY"}
              tripDates={tripDateRange(trip.data)}
              onOpenChannel={setOpenChannelId}
              onManageMembers={() => setManagingMembers(true)}
              onInviteMembers={() => setInviting(true)}
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

          {viewingActivity ? (
            <ActivityDialog
              tripId={trip.data.id}
              onClose={() => setViewingActivity(false)}
            />
          ) : null}

          <ChatPanel
            tripId={trip.data.id}
            tripName={trip.data.name}
            tripSocket={tripSocket}
            categories={categories.data ?? []}
            myRole={trip.data.role}
            myUserId={user?.id}
            requestChannelId={openChannelId}
            onRequestHandled={() => setOpenChannelId(null)}
          />

          {confirmingDelete ? (
            <Dialog
              eyebrow="Delete board"
              title={t("Delete “{trip}”?", { trip: trip.data.name })}
              describedById="delete-board-blurb"
              onClose={() => setConfirmingDelete(false)}
            >
              <p className="board__muted" id="delete-board-blurb">
                {t(
                  "This permanently removes the board and its membership for everyone. This can't be undone.",
                )}
              </p>
              <div className="board__dialog-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t("Cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={deleteTrip.isPending}
                  onClick={onDelete}
                >
                  {deleteTrip.isPending ? t("Deleting…") : t("Delete board")}
                </Button>
              </div>
            </Dialog>
          ) : null}
        </>
      )}
    </main>
  );
}
