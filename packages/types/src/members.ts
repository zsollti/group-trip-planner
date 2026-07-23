import { z } from "zod";
import { TripRole } from "./trips.js";

/**
 * Membership-management contract (Phase 1.4, SRS §3 + FR-12/17) — the shared
 * shapes for the member list and the role/kick/block/leave/transfer mutations.
 * The authorization rules themselves live in `permissions.ts` (`canActOn`,
 * `canAssignRole`) and are enforced server-side; these schemas only describe the
 * request/response boundary the three front-ends render from.
 */

/** A trip member as shown in the member-management list. */
export const TripMemberView = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  role: TripRole,
  joinedAt: z.string(),
  /** True for the trip's owner (the denormalized `ownerId`), for UI emphasis. */
  isOwner: z.boolean(),
});
export type TripMemberView = z.infer<typeof TripMemberView>;

/** A blocked (ejected + barred) user, listed so an organizer can unblock them. */
export const TripBlockView = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  blockedAt: z.string(),
});
export type TripBlockView = z.infer<typeof TripBlockView>;

/** The member-management payload: current members plus the block list. */
export const TripMembersView = z.object({
  members: z.array(TripMemberView),
  blocked: z.array(TripBlockView),
});
export type TripMembersView = z.infer<typeof TripMembersView>;

/**
 * Roles a member may be *assigned* by a role change (SRS FR-14 mirror). OWNER is
 * excluded — ownership only moves by explicit transfer, never a role edit.
 */
export const AssignableRole = z.enum(["GUEST", "PARTICIPANT", "CO_ORGANIZER"]);
export type AssignableRole = z.infer<typeof AssignableRole>;

/** Change a member's role. */
export const ChangeMemberRoleInput = z.object({ role: AssignableRole });
export type ChangeMemberRoleInput = z.infer<typeof ChangeMemberRoleInput>;

/** Transfer ownership to an existing member (Owner only, SRS FR-12). */
export const TransferOwnershipInput = z.object({
  userId: z.string().uuid(),
});
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInput>;
