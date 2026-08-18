import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  ROLE_RANK,
  can,
  canActOn,
  type AssignableRole,
  type TripMemberView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useAuth,
  useBlockMember,
  useChangeMemberRole,
  useKickMember,
  useTransferOwnership,
  useTripMembers,
  useUnblockMember,
} from "@gtp/api-client";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { Menu, type MenuItem } from "./Menu";
import { roleChangeLabel, roleLabel } from "../lib/roles";
import { t } from "../lib/i18n";

const ASSIGNABLE: AssignableRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

type Pending = {
  kind: "kick" | "block" | "transfer";
  userId: string;
  name: string;
};

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
  const changeRole = useChangeMemberRole(tripId);
  const kick = useKickMember(tripId);
  const block = useBlockMember(tripId);
  const unblock = useUnblockMember(tripId);
  const transfer = useTransferOwnership(tripId);

  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assignableRoles = ASSIGNABLE.filter(
    (r) => ROLE_RANK[r] < ROLE_RANK[myRole],
  );

  function report(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  async function onChangeRole(m: TripMemberView, role: AssignableRole) {
    setError(null);
    try {
      await changeRole.mutateAsync({ userId: m.userId, role });
    } catch (err) {
      report(err, t("Could not change the role"));
    }
  }

  async function onConfirm() {
    setError(null);
    try {
      if (pending?.kind === "kick") await kick.mutateAsync(pending.userId);
      else if (pending?.kind === "block")
        await block.mutateAsync(pending.userId);
      else if (pending?.kind === "transfer") {
        await transfer.mutateAsync(pending.userId);
        setPending(null);
        onClose();
        return;
      }
      setPending(null);
    } catch (err) {
      report(err, t("Could not complete that action"));
    }
  }

  const canManage = can(myRole, "member.manage");
  const canTransfer = can(myRole, "trip.transferOwnership");

  /**
   * The "⋯" for one member: what you can do to them, in the order you are
   * likely to want it — promote or demote, then remove, block, hand over.
   *
   * Each role gets its own sentence rather than "Make {role}" with the name
   * interpolated: Hungarian puts a case ending on the role for this ("legyen
   * társszervező"), so a shared frame with a slot in it cannot be translated
   * correctly for every value.
   */
  function memberMenuItems(m: TripMemberView): MenuItem[] {
    const items: MenuItem[] = assignableRoles
      .filter((r) => r !== m.role)
      .map((r) => ({
        label: roleChangeLabel(r),
        disabled: changeRole.isPending,
        onSelect: () => void onChangeRole(m, r),
      }));

    // Everything below the rule takes someone off the trip or hands it over.
    // `separated` marks the first of them, so the break moves with the list
    // rather than being drawn at a fixed index.
    items.push({
      label: t("Remove from trip"),
      danger: true,
      separated: true,
      onSelect: () =>
        setPending({ kind: "kick", userId: m.userId, name: m.displayName }),
    });
    items.push({
      label: t("Block"),
      danger: true,
      onSelect: () =>
        setPending({ kind: "block", userId: m.userId, name: m.displayName }),
    });
    if (canTransfer) {
      items.push({
        label: t("Make owner"),
        danger: true,
        onSelect: () =>
          setPending({
            kind: "transfer",
            userId: m.userId,
            name: m.displayName,
          }),
      });
    }
    return items;
  }

  return (
    <Dialog eyebrow="Crew" title={t("Members & roles")} onClose={onClose}>
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
              {members.data.members.map((m) => {
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
                      ) : null}{" "}
                      <span className="board__muted">{roleLabel(m.role)}</span>
                    </div>
                    <div className="board__invite-item-actions">
                      {manageable ? (
                        <Menu
                          label={t("Actions for {name}", {
                            name: m.displayName,
                          })}
                          items={memberMenuItems(m)}
                        />
                      ) : null}
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

        {error ? (
          <p className="board__form-error" role="alert">
            {error}
          </p>
        ) : null}

        {pending ? (
          <div className="board__dialog-actions board__dialog-actions--stack">
            <p className="board__muted">
              {pending.kind === "kick"
                ? `Remove ${pending.name}? They can rejoin via a live link.`
                : pending.kind === "block"
                  ? `Block ${pending.name}? They're removed and barred from rejoining.`
                  : `Make ${pending.name} the owner? You'll become a co-organizer.`}
            </p>
            <div className="board__dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPending(null)}
              >
                {t("Cancel")}
              </Button>
              <Button type="button" variant="primary" onClick={onConfirm}>
                {pending.kind === "transfer"
                  ? t("Transfer ownership")
                  : t("Confirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </>
    </Dialog>
  );
}
