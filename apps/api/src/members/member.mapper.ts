import type { TripBlock, TripMembership, TripRole } from "@prisma/client";
import type { TripMemberView, TripBlockView } from "@gtp/types";

type MembershipWithUser = TripMembership & {
  user: { displayName: string; avatarUrl: string | null };
};
type BlockWithUser = TripBlock & { user: { displayName: string } };

/** A membership row → the member-list view, flagging the trip owner. */
export function toTripMemberView(
  m: MembershipWithUser,
  ownerId: string,
): TripMemberView {
  return {
    userId: m.userId,
    displayName: m.user.displayName,
    avatarUrl: m.user.avatarUrl,
    role: m.role as TripRole,
    joinedAt: m.joinedAt.toISOString(),
    isOwner: m.userId === ownerId,
  };
}

/** A block row → the blocked-list view (drives the unblock control). */
export function toTripBlockView(b: BlockWithUser): TripBlockView {
  return {
    userId: b.userId,
    displayName: b.user.displayName,
    blockedAt: b.createdAt.toISOString(),
  };
}
