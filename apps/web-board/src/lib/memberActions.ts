import { useState } from "react";
import {
  ROLE_RANK,
  type AssignableRole,
  type TripMemberView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useBlockMember,
  useChangeMemberRole,
  useKickMember,
  useTransferOwnership,
} from "@gtp/api-client";
import { t } from "./i18n";

/** The roles anyone may be moved between. Owner is not among them — it is not
 *  assigned, it is handed over, which is a different act with its own confirm. */
export const ASSIGNABLE_ROLES: AssignableRole[] = [
  "GUEST",
  "PARTICIPANT",
  "CO_ORGANIZER",
];

/** The three acts that cannot be taken back, and so are the three that confirm. */
export type MemberActionKind = "kick" | "block" | "transfer";

export interface PendingMemberAction {
  kind: MemberActionKind;
  userId: string;
  name: string;
}

/**
 * Everything one member's row can do, in one place.
 *
 * Two surfaces carry these now — the members dialog and the crew panel's
 * per-person quick actions — and they must not drift. The thing that would
 * drift first is the part that matters most: which acts stop for a confirm.
 * Kick, block and transfer are irreversible in three different ways, so the
 * confirm is not decoration on them, and a second copy of this glue is a second
 * chance to forget one.
 *
 * The rank rule lives here too. `assignableRoles` is every role strictly below
 * the reader's, which is the same rule `canActOn` applies to whether a row is
 * actionable at all — so a member a reader may act on always has their current
 * role among the offered ones, and a role control can never render blank.
 */
export function useMemberActions(
  tripId: string,
  myRole: TripRole,
  opts: { onTransferred?: () => void } = {},
): {
  assignableRoles: AssignableRole[];
  pending: PendingMemberAction | null;
  error: string | null;
  busy: boolean;
  /** Change a role now — reversible, so no confirm. */
  setRole: (member: TripMemberView, role: AssignableRole) => void;
  /** Stage one of the irreversible three; nothing happens until `confirm`. */
  ask: (kind: MemberActionKind, member: TripMemberView) => void;
  cancel: () => void;
  confirm: () => void;
} {
  const changeRole = useChangeMemberRole(tripId);
  const kick = useKickMember(tripId);
  const block = useBlockMember(tripId);
  const transfer = useTransferOwnership(tripId);

  const [pending, setPending] = useState<PendingMemberAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  function report(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  return {
    assignableRoles: ASSIGNABLE_ROLES.filter(
      (r) => ROLE_RANK[r] < ROLE_RANK[myRole],
    ),
    pending,
    error,
    busy:
      changeRole.isPending ||
      kick.isPending ||
      block.isPending ||
      transfer.isPending,
    setRole: (member, role) => {
      setError(null);
      changeRole
        .mutateAsync({ userId: member.userId, role })
        .catch((err) => report(err, t("Could not change the role")));
    },
    ask: (kind, member) =>
      setPending({ kind, userId: member.userId, name: member.displayName }),
    cancel: () => setPending(null),
    confirm: () => {
      if (!pending) return;
      setError(null);
      const done = () => setPending(null);
      const fail = (err: unknown) =>
        report(err, t("Could not complete that action"));
      if (pending.kind === "kick") {
        kick.mutateAsync(pending.userId).then(done, fail);
      } else if (pending.kind === "block") {
        block.mutateAsync(pending.userId).then(done, fail);
      } else {
        transfer.mutateAsync(pending.userId).then(() => {
          done();
          opts.onTransferred?.();
        }, fail);
      }
    },
  };
}

/** What a staged action will do, said in full — including what happens after,
 *  which is the entire difference between removing someone and blocking them. */
export function memberActionQuestion(pending: PendingMemberAction): string {
  if (pending.kind === "kick") {
    return t("Remove {name} from this trip? You can invite them back.", {
      name: pending.name,
    });
  }
  if (pending.kind === "block") {
    return t(
      "Remove {name} and block them? They won't be able to rejoin, even with an invite link.",
      { name: pending.name },
    );
  }
  return t(
    "Make {name} the owner? You'll become a co-organizer, and only they can hand it back.",
    { name: pending.name },
  );
}
