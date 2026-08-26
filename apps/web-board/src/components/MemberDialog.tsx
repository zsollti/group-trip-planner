import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canActOn,
  type AssignableRole,
  type TripMemberView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useAuth,
  useTripMembers,
  useUnblockMember,
} from "@gtp/api-client";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { MemberConfirm } from "./MemberConfirm";
import { Menu, type MenuItem } from "./Menu";
import { useMemberActions } from "../lib/memberActions";
import { byRole, roleLabel } from "../lib/roles";
import { t } from "../lib/i18n";

/**
 * Board-paradigm crew dialog: a floating card listing members with role controls
 * gated by the `canActOn` strictly-lower rule (a Co-organizer sees no controls
 * on the Owner or a peer). The Owner can hand off ownership (with a confirm);
 * non-owners get Leave; blocked people list with an unblock control (FR-12/17).
 *
 * **One "⋯" per member, not four controls.** Every row used to carry a role
 * `<select>` and three buttons (Kick, Block, Make owner), so a five-person trip
 * rendered twenty controls and the names they belonged to were the least
 * prominent thing on the row. Worse, "Make owner" repeated on every line for
 * something a trip does once. They collapse into the same "⋯" the lanes and the
 * trip header already use: the role choices first, then a rule, then the
 * destructive three. The row is back to being a list of people.
 *
 * The menu offers only the roles the member is **not** — their current one is
 * already written beside their name, so listing it again would be a menu item
 * that does nothing.
 *
 * **Leaving is not here**, though it used to be, at the foot of the card. It was
 * the one control on this surface that was about the reader rather than about
 * somebody else, which is precisely the argument against it: this dialog answers
 * "who is on the trip, and what may I do to them". Walking away from the trip is
 * an action *on the trip*, and every one of those lives in the trip's own "⋯" —
 * where it also sits next to the only thing it can be confused with, Delete. See
 * `TripDetail`.
 */
export function MemberDialog({
  tripId,
  myRole,
  onClose,
}: {
  tripId: string;
  myRole: TripRole;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const members = useTripMembers(tripId);
  const unblock = useUnblockMember(tripId);
  // Shared with the crew panel's per-person quick actions — see
  // `lib/memberActions`. Handing the trip over closes this dialog: the reader
  // is no longer the owner, so the controls they were looking at are not theirs.
  const actions = useMemberActions(tripId, myRole, { onTransferred: onClose });
  const { assignableRoles, pending } = actions;

  const [error, setError] = useState<string | null>(null);

  function report(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  const canManage = can(myRole, "member.manage");
  const canTransfer = can(myRole, "trip.transferOwnership");

  /**
   * The "⋯" for one member — now **only the things that cannot be taken back**.
   *
   * It used to hold the role changes too: six items, three of which were the
   * commonest thing anyone does here and were two clicks and a read down a list
   * away. The role moved onto the row as a select, where it is one gesture and
   * where it also *states* the current role instead of leaving the reader to
   * infer it from which options are offered.
   *
   * What is left is removal, blocking and handing the trip over. They stay in a
   * menu deliberately: three destructive buttons on every row is a wall of red
   * on a list you mostly open to check who is here, and the one thing worse
   * than an action being hard to find is an irreversible one being easy to hit.
   *
   * **Each carries a note**, because the labels do not carry the distinction.
   * "Remove" and "Block" are the same act with a different afterwards, and no
   * verb pair tells a reader that on its own — the difference is whether the
   * person can come back, so that is what the notes say, in those words.
   */
  function memberMenuItems(m: TripMemberView): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: t("Remove from trip"),
        note: t("They lose access. You can invite them back."),
        danger: true,
        onSelect: () => actions.ask("kick", m),
      },
      {
        label: t("Remove and block"),
        note: t("They lose access and can't rejoin, even with a link."),
        danger: true,
        onSelect: () => actions.ask("block", m),
      },
    ];
    if (canTransfer) {
      items.push({
        label: t("Make owner"),
        note: t("They take over the trip and you become a co-organizer."),
        danger: true,
        separated: true,
        onSelect: () => actions.ask("transfer", m),
      });
    }
    return items;
  }

  return (
    <Dialog title={t("Crew")} onClose={onClose}>
      <>
        {members.isPending ? (
          <p className="board__muted" role="status">
            {t("Loading crew…")}
          </p>
        ) : members.isError ? (
          <>
            <p className="board__form-error" role="alert">
              {t("Couldn't load the member list.")}
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
          <>
            <ul className="board__invite-items">
              {/* Same order as the crew panel behind this dialog — the two are
                  the same list, and a reader who opened one from the other
                  should not have to find their place again. */}
              {byRole(members.data.members).map((m) => {
                const isSelf = m.userId === user?.id;
                const manageable =
                  canManage && !isSelf && canActOn(myRole, m.role);
                return (
                  <li key={m.userId} className="board__invite-item">
                    <div className="board__member-identity">
                      <Avatar
                        name={m.displayName}
                        userId={m.userId}
                        url={m.avatarUrl}
                        size={28}
                      />
                      <strong>{m.displayName}</strong>
                      {isSelf ? (
                        <span className="board__muted"> {t("(you)")}</span>
                      ) : null}
                    </div>
                    <div className="board__invite-item-actions">
                      {/*
                       * The role, as the control that changes it.
                       *
                       * It was a word beside the name plus three menu entries
                       * behind a "⋯" — so the fact and the way to change it
                       * were in two places, and the commonest action on this
                       * screen was the one furthest from the hand. A select is
                       * both at once: it states the role and it is how you set
                       * it, in one gesture, in the column where every row's
                       * role lines up and can be compared.
                       *
                       * The owner's row, and anyone this reader may not act on,
                       * keeps the plain word — a disabled select reads as
                       * something temporarily unavailable rather than as
                       * something that is not theirs to change.
                       */}
                      {manageable ? (
                        <>
                          <label
                            className="board__sr-only"
                            htmlFor={`role-${m.userId}`}
                          >
                            {t("Role for {name}", { name: m.displayName })}
                          </label>
                          <select
                            id={`role-${m.userId}`}
                            className="board__select board__member-role"
                            value={m.role}
                            disabled={actions.busy}
                            onChange={(e) =>
                              actions.setRole(
                                m,
                                e.target.value as AssignableRole,
                              )
                            }
                          >
                            {/* Only the roles this reader may hand out — the
                                same list the menu offered. The member's own is
                                always among them wherever this select renders:
                                a row is manageable only when the reader
                                outranks it, and the list is every role below
                                the reader. Worth stating, because a select
                                whose value is not in its options renders blank,
                                and the next change would read as a demotion
                                nobody chose. */}
                            {assignableRoles.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                          <Menu
                            label={t("Actions for {name}", {
                              name: m.displayName,
                            })}
                            items={memberMenuItems(m)}
                          />
                        </>
                      ) : (
                        <span className="board__muted">
                          {roleLabel(m.role)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {canManage && members.data.blocked.length > 0 ? (
              <div className="board__invite-list">
                <p className="board__eyebrow">{t("Blocked")}</p>
                <ul className="board__invite-items">
                  {members.data.blocked.map((b) => (
                    <li key={b.userId} className="board__invite-item">
                      <div>
                        <strong>{b.displayName}</strong>{" "}
                        <span className="board__muted">
                          {t("barred from rejoining")}
                        </span>
                      </div>
                      <div className="board__invite-item-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={unblock.isPending}
                          onClick={() => {
                            setError(null);
                            unblock
                              .mutateAsync(b.userId)
                              .catch((err) =>
                                report(err, t("Could not unblock")),
                              );
                          }}
                        >
                          {t("Unblock")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {(error ?? actions.error) ? (
          <p className="board__form-error" role="alert">
            {error ?? actions.error}
          </p>
        ) : null}

        {/* The question, and the words it is asked in, are shared with the crew
            panel's quick actions — see `MemberConfirm`. Whichever way a reader
            reached "remove and block", they are told the same thing about what
            happens afterwards, which is the only difference between it and the
            item above it. */}
        {pending ? (
          <MemberConfirm
            pending={pending}
            onCancel={actions.cancel}
            onConfirm={actions.confirm}
          />
        ) : null}
      </>
    </Dialog>
  );
}
