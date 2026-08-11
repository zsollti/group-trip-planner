import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  useLeaveTrip,
  useTransferOwnership,
  useTripMembers,
  useUnblockMember,
} from "@gtp/api-client";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { ROLE_LABEL } from "../lib/roles";

const ASSIGNABLE: AssignableRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

type Pending =
  | { kind: "kick" | "block" | "transfer"; userId: string; name: string }
  | { kind: "leave" };

/**
 * Board-paradigm crew dialog: a floating card listing members with role controls
 * gated by the `canActOn` strictly-lower rule (a Co-organizer sees no controls
 * on the Owner or a peer). The Owner can hand off ownership (with a confirm);
 * non-owners get Leave; blocked people list with an unblock control (FR-12/17).
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
  const navigate = useNavigate();
  const members = useTripMembers(tripId);
  const changeRole = useChangeMemberRole(tripId);
  const kick = useKickMember(tripId);
  const block = useBlockMember(tripId);
  const unblock = useUnblockMember(tripId);
  const transfer = useTransferOwnership(tripId);
  const leave = useLeaveTrip(tripId);

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
      report(err, "Could not change the role");
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
      } else if (pending?.kind === "leave") {
        await leave.mutateAsync();
        navigate("/");
        return;
      }
      setPending(null);
    } catch (err) {
      report(err, "Could not complete that action");
    }
  }

  const canManage = can(myRole, "member.manage");
  const canLeave = can(myRole, "trip.leave");
  const canTransfer = can(myRole, "trip.transferOwnership");

  return (
    <Dialog eyebrow="Crew" title="Members & roles" onClose={onClose}>
      <>
        {members.isPending ? (
          <p className="board__muted" role="status">
            Loading crew…
          </p>
        ) : members.isError ? (
          <>
            <p className="board__form-error" role="alert">
              Couldn't load the member list.
            </p>
            <button
              type="button"
              className="board__cta"
              onClick={() => void members.refetch()}
            >
              Try again
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
                        <span className="board__muted"> (you)</span>
                      ) : null}{" "}
                      <span className="board__muted">{ROLE_LABEL[m.role]}</span>
                    </div>
                    <div className="board__invite-item-actions">
                      {manageable ? (
                        <>
                          <select
                            className="board__select"
                            aria-label={`Role for ${m.displayName}`}
                            value={m.role}
                            disabled={changeRole.isPending}
                            onChange={(e) =>
                              onChangeRole(m, e.target.value as AssignableRole)
                            }
                          >
                            {assignableRoles.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setPending({
                                kind: "kick",
                                userId: m.userId,
                                name: m.displayName,
                              })
                            }
                          >
                            Kick
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setPending({
                                kind: "block",
                                userId: m.userId,
                                name: m.displayName,
                              })
                            }
                          >
                            Block
                          </Button>
                          {canTransfer ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                setPending({
                                  kind: "transfer",
                                  userId: m.userId,
                                  name: m.displayName,
                                })
                              }
                            >
                              Make owner
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {canManage && members.data.blocked.length > 0 ? (
              <div className="board__invite-list">
                <p className="board__eyebrow">Blocked</p>
                <ul className="board__invite-items">
                  {members.data.blocked.map((b) => (
                    <li key={b.userId} className="board__invite-item">
                      <div>
                        <strong>{b.displayName}</strong>{" "}
                        <span className="board__muted">
                          barred from rejoining
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
                              .catch((err) => report(err, "Could not unblock"));
                          }}
                        >
                          Unblock
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
                  : pending.kind === "transfer"
                    ? `Make ${pending.name} the owner? You'll become a co-organizer.`
                    : "Leave this trip? You'll lose access unless re-invited."}
            </p>
            <div className="board__dialog-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={onConfirm}>
                {pending.kind === "leave"
                  ? "Leave trip"
                  : pending.kind === "transfer"
                    ? "Transfer ownership"
                    : "Confirm"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="board__dialog-actions">
            {canLeave ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPending({ kind: "leave" })}
              >
                Leave trip
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </>
    </Dialog>
  );
}
