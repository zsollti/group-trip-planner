import { can, type TripRole } from "@gtp/types";
import { useTripMembers } from "@gtp/api-client";
import { Avatar } from "./Avatar";
import { roleLabel } from "../lib/roles";
import { t } from "../lib/i18n";

/**
 * Who is on this trip, at the top of the board.
 *
 * It replaces the Decided rail, and the swap is the point. The rail showed the
 * trip's answers a second time — every decision in it was already pinned at the
 * top of the lane that made it, so the band above the board was spending its
 * space repeating what was directly below it. The one thing a planning board
 * genuinely could not tell you was **who you were planning with**: the member
 * count was a number in the subtitle, and the names were two clicks away behind
 * a "⋯" menu, which is a strange place to keep the group in a group trip
 * planner.
 *
 * Read-only on purpose. Roles, kicks, blocks and ownership transfer stay in
 * {@link MemberDialog} — those are consequential and belong behind a deliberate
 * click, and putting a role `<select>` in a strip you scan past would make the
 * board's most destructive controls its most ambient ones. This panel answers
 * "who's here?"; the dialog answers "change who's here".
 */
export function CrewPanel({
  tripId,
  myRole,
  myUserId,
  onManage,
  onInvite,
}: {
  tripId: string;
  myRole: TripRole;
  /**
   * Marks "(you)" in the list. Passed down rather than read from `useAuth`,
   * which the board already has to hand: reaching for the auth context here
   * would make a panel that renders a list depend on a session provider, and
   * every test of the board would have to mount one to render a name.
   */
  myUserId: string | undefined;
  /** Open the full members dialog — role changes, kick, block, transfer. */
  onManage: () => void;
  /**
   * Open the invite dialog. Shown next to Manage rather than in the trip header,
   * where it used to sit: inviting is something you do *to the crew*, and the
   * header had it a whole screen away from the list of who is already here.
   */
  onInvite: () => void;
}) {
  const members = useTripMembers(tripId);
  // Read once. The count in the heading and the list below it are the same
  // fact, and reading `members.data.members` twice is how they come to disagree.
  const roster = members.data?.members;

  // Everyone can see who they are travelling with (the member list is member-
  // scoped, not organizer-scoped); only organizers get the way in to change it.
  const canManage = can(myRole, "member.manage");
  // Guests can read the crew but cannot grow it, so they get no Invite at all —
  // the same gate the header button carried before it moved here.
  const canInvite = can(myRole, "invite.create");

  return (
    <section className="crew" aria-label={t("Crew")}>
      <h2 className="crew__head">
        <span aria-hidden="true">👥 </span>
        {t("Crew")}
        {roster ? <span className="crew__count">{roster.length}</span> : null}
        {/* Invite leads: it is the outward action, and it reads as the answer to
            the list beside it ("this is the crew — add to it"). Manage stays
            last, next to the people it acts on. */}
        <span className="crew__actions">
          {canInvite ? (
            <button type="button" className="crew__action" onClick={onInvite}>
              {t("Invite")}
            </button>
          ) : null}
          <button type="button" className="crew__action" onClick={onManage}>
            {canManage ? t("Manage") : t("View")}
          </button>
        </span>
      </h2>

      {members.isPending ? (
        <p className="board__muted" role="status">
          {t("Loading crew…")}
        </p>
      ) : members.isError ? (
        <>
          <p className="board__form-error" role="alert">
            {t("Couldn't load the crew.")}
          </p>
          <button
            type="button"
            className="board__cta"
            onClick={() => void members.refetch()}
          >
            {t("Try again")}
          </button>
        </>
      ) : (
        <ul className="crew__row">
          {(roster ?? []).map((m) => (
            <li key={m.userId} className="crew__member">
              <Avatar
                name={m.displayName}
                userId={m.userId}
                url={m.avatarUrl}
                size={28}
              />
              <span className="crew__who">
                <span className="crew__name">
                  {m.displayName}
                  {m.userId === myUserId ? (
                    <span className="board__muted"> {t("(you)")}</span>
                  ) : null}
                </span>
                {/* The role is the "maybe" in the ask, and it earns its place:
                    knowing who can actually lock a decision is the difference
                    between waiting for someone and asking the wrong person. */}
                <span className="crew__role">{roleLabel(m.role)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
