import { useState } from "react";
import { intlTag } from "../lib/locale";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  useBoardLiveSync,
  useDeleteTrip,
  useLeaveTrip,
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
import { BoardRail } from "../components/BoardRail";
import { TimelineCanvas } from "../components/TimelineCanvas";
import { ViewToggle, type TripView } from "../components/ViewToggle";
import { Menu, type MenuItem } from "../components/Menu";
import { Brand } from "../components/Brand";
import { UserMenu } from "../components/UserMenu";
import { LiveIndicator } from "../components/LiveIndicator";
import { NotificationToasts } from "../components/NotificationToasts";
import { ChatPanel } from "../components/ChatPanel";
import { Dialog } from "../components/Dialog";
import { tripDateForDisplay } from "../lib/tripDate";
import { plural, t } from "../lib/i18n";

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
 * A trip, in one of its two views.
 *
 * **The itinerary is no longer a separate page.** It was its own route with its
 * own header, its own title and its own way back, and that was the problem: the
 * two answer questions about the same trip, and moving between them felt like
 * leaving. They now share everything above the working surface — the header,
 * the name and dates, the rail of what it costs and who is on it — and the
 * Plan/Timeline switch replaces only the part that differs. Which is exactly
 * what a reader means by "show me this trip on a calendar".
 *
 * It stays two routes ({@link ViewToggle} explains why), so this renders both:
 * `/trips/:id` is Plan, `/trips/:id/timeline` is Timeline, and the only thing
 * that changes between them is what fills the space next to the rail.
 *
 * The chat panel is mounted in both, deliberately. A discussion is about the
 * trip, not about how you happen to be looking at it.
 */
export function TripDetail({ view = "plan" }: { view?: TripView }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const trip = useTrip(id);
  const deleteTrip = useDeleteTrip(id ?? "");
  const leaveTrip = useLeaveTrip(id ?? "");
  const setMute = useSetTripMute(id ?? "");
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [viewingActivity, setViewingActivity] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
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
   * Take yourself off this trip (FR-17).
   *
   * Confirmed rather than done on the click, and the confirmation is the reason
   * this is worth its own dialog: leaving is irreversible from the leaver's side
   * — the board disappears from their list and only somebody still on it can
   * hand it back — while looking, in a menu, exactly like the reversible things
   * above it.
   */
  async function onLeave() {
    setActionError(null);
    try {
      await leaveTrip.mutateAsync();
      navigate("/");
    } catch (err) {
      setConfirmingLeave(false);
      setActionError(
        err instanceof ApiError ? err.message : t("Could not leave this trip"),
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
    // Leaving lived at the foot of the crew dialog, which is a list of *other*
    // people — so the one row about the reader was the one row that was not a
    // person. It belongs with the other things you can do to this trip, and
    // being here puts it next to the only action it can be confused with
    // (Delete), where the difference between "I'm out" and "it's gone for
    // everyone" is stated by two adjacent labels rather than by a screen apart.
    if (can(role, "trip.leave")) {
      items.push({
        label: t("Leave trip"),
        onSelect: () => setConfirmingLeave(true),
        separated: true,
        danger: true,
      });
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
        <Brand />
        <div className="board__bar-actions">
          {trip.data ? <LiveIndicator status={tripSocket.status} /> : null}
          {/* Only the toasts sit here now — the list itself is in the account
              menu. The socket's personal room carries notifications for every
              trip the user belongs to, not just this one (Phase 5.1,
              decision 1). */}
          <NotificationToasts socket={tripSocket.socket} />
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
          {/*
           * Everything the trip says about itself, in two rows instead of four.
           *
           * The status, the name, the facts and the view switch were four
           * stacked blocks, each with its own margins, and between them they
           * pushed the working surface — the entire point of the page — a long
           * way down a laptop screen. It is folded rather than dropped, with one
           * exception noted below.
           *
           * Row one is the name. Row two is one sentence — what this board is to
           * you, then what it is — with the view switch at the far end of it.
           *
           * **The switch sits on the facts row, not beside the name.** It went
           * next to the name first, on the reasoning that a control belongs
           * beside what it changes; a cover image is what showed that to be
           * half the story. The cover comes between the name and the facts, so
           * a switch pinned to the name floats above the picture, cut off from
           * every other thing the page says about this trip. Below it, the
           * switch reads as one of them.
           */}
          <div className="triphead">
            <h1 className="board__title triphead__name">{trip.data.name}</h1>
            {/* Decorative: the trip's name and destination are right here in
                text, so the cover adds atmosphere, not information. */}
            {trip.data.coverImageUrl ? (
              <img
                className="board__cover"
                src={trip.data.coverImageUrl}
                alt=""
              />
            ) : null}
            <div className="triphead__meta">
              <p className="triphead__line">
                {/* No "Active ·" any more, and no role either. Both were facts
                    about the *reader* rather than about the trip, sitting where
                    the trip says what it is; the status because it was true of
                    all but a handful of boards, and the role because the one
                    place it changes anything — who may do what — is the crew
                    panel, where it is printed against each person's name. A
                    board that is not active still says so, much louder, in the
                    read-only banner directly below this line. */}
                <span className="triphead__facts">
                  {trip.data.destination ?? t("No destination yet")} ·{" "}
                  {fmtDate(trip.data.startDate)} – {fmtDate(trip.data.endDate)}{" "}
                  · {plural(trip.data.memberCount, "{n} member", "{n} members")}{" "}
                  · {trip.data.defaultCurrency}
                </span>
                {/* Muting is invisible by nature — say so, or people forget they
                    did it and wonder why the inbox is quiet (Phase 5.3). */}
                {trip.data.viewerMuted ? (
                  <span className="board__mutedflag">
                    {t("· 🔕 Email muted")}
                  </span>
                ) : null}
              </p>
              <ViewToggle tripId={trip.data.id} view={view} />
            </div>
          </div>
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
            <div className="board__layout">
              <BoardRail
                tripId={trip.data.id}
                myRole={trip.data.role}
                myUserId={user?.id}
                onManageMembers={() => setManagingMembers(true)}
                onInviteMembers={() => setInviting(true)}
              />
              {/*
               * The half of the page the switch replaces, wrapped so it can be
               * *seen* being replaced.
               *
               * `key={view}` is what makes the animation run: without it React
               * keeps this div across the switch, and a CSS animation attached
               * to an element that was never re-created plays exactly once, on
               * the first load, and never again. Keyed, the outgoing view is
               * torn down and the incoming one enters — which is what the
               * Plan/Timeline control has claimed since the two pages were
               * fused into one screen, and the only part of the claim the eye
               * could not previously check.
               *
               * The direction is read off the view rather than off which view
               * came before: Plan is the left segment of the toggle and
               * Timeline the right one, so each always enters from its own
               * side. Deriving it from the previous view would have made
               * arriving at a URL directly look different from switching to it.
               */}
              <div className="board__view" data-view={view} key={view}>
                {view === "timeline" ? (
                  <TimelineCanvas
                    tripId={trip.data.id}
                    categories={categories.data}
                    tripDates={tripDateRange(trip.data)}
                  />
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
                  />
                )}
              </div>
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

          {confirmingLeave ? (
            <Dialog
              eyebrow="Leave trip"
              title={t("Leave “{trip}”?", { trip: trip.data.name })}
              describedById="leave-board-blurb"
              onClose={() => setConfirmingLeave(false)}
            >
              <p className="board__muted" id="leave-board-blurb">
                {t("Leave this trip? You'll lose access unless re-invited.")}
              </p>
              <div className="board__dialog-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingLeave(false)}
                >
                  {t("Cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={leaveTrip.isPending}
                  onClick={onLeave}
                >
                  {leaveTrip.isPending ? t("Leaving…") : t("Leave trip")}
                </Button>
              </div>
            </Dialog>
          ) : null}

          {/*
           * The confirm, cut to the question and the answer.
           *
           * The eyebrow read "Delete board" directly above a heading reading
           * "Delete “Lisbon”?" — a label whose only content is the first word
           * of the sentence under it. And Cancel sat beside Delete doing
           * exactly what the card's own ✕ does, one tab-stop from the
           * irreversible half of the pair: the way out of a dialog is in the
           * corner of every dialog in this app, so spelling it out here bought
           * nothing and put a click that destroys a trip next to a click that
           * does nothing at all. Escape still closes it too.
           */}
          {confirmingDelete ? (
            <Dialog
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
