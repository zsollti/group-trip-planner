import { useEffect, useState } from "react";
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

const ROLE_LABEL: Record<TripRole, string> = {
  OWNER: "Owner",
  CO_ORGANIZER: "Co-organizer",
  PARTICIPANT: "Participant",
  GUEST: "Guest",
};

const ASSIGNABLE: AssignableRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER"];

type Pending =
  | { kind: "kick" | "block" | "transfer"; userId: string; name: string }
  | { kind: "leave" };

/**
 * Deck-paradigm crew roster: a command dialog listing members with role controls
 * (change role, kick, block) gated by the same `canActOn` strictly-lower rule the
 * API enforces — a Co-organizer sees no controls on the Owner or a peer. The
 * Owner can hand off ownership (with a confirm); non-owners get a Leave action;
 * blocked users are listed with an unblock control (FR-12/17).
 */
export function MemberManager({
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="deck__palette-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="deck__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Crew"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="deck__eyebrow">Crew</p>
        <h2 className="deck__dialog-title">Members &amp; roles</h2>

        {members.isPending ? (
          <p className="deck__muted">Loading crew…</p>
        ) : members.isError ? (
          <p className="deck__form-error" role="alert">
            Couldn't load the member list.
          </p>
        ) : (
          <>
            <ul className="deck__invite-items">
              {members.data.members.map((m) => {
                const isSelf = m.userId === user?.id;
                const manageable =
                  canManage && !isSelf && canActOn(myRole, m.role);
                return (
                  <li key={m.userId} className="deck__invite-item">
                    <div>
                      <strong>{m.displayName}</strong>
                      {isSelf ? (
                        <span className="deck__muted"> (you)</span>
                      ) : null}{" "}
                      <span className="deck__badge">{ROLE_LABEL[m.role]}</span>
                    </div>
                    <div className="deck__invite-item-actions">
                      {manageable ? (
                        <>
                          <select
                            className="deck__select"
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
              <div className="deck__invite-list">
                <p className="deck__eyebrow">Blocked</p>
                <ul className="deck__invite-items">
                  {members.data.blocked.map((b) => (
                    <li key={b.userId} className="deck__invite-item">
                      <div>
                        <strong>{b.displayName}</strong>{" "}
                        <span className="deck__muted">
                          barred from rejoining
                        </span>
                      </div>
                      <div className="deck__invite-item-actions">
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
          <p className="deck__form-error" role="alert">
            {error}
          </p>
        ) : null}

        {pending ? (
          <div className="deck__confirm">
            <p className="deck__muted">
              {pending.kind === "kick"
                ? `Remove ${pending.name}? They can rejoin via a live link.`
                : pending.kind === "block"
                  ? `Block ${pending.name}? They're removed and barred from rejoining.`
                  : pending.kind === "transfer"
                    ? `Make ${pending.name} the owner? You'll become a co-organizer.`
                    : "Leave this trip? You'll lose access unless re-invited."}
            </p>
            <div className="deck__dialog-actions">
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
          <div className="deck__dialog-actions">
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
      </div>
    </div>
  );
}
