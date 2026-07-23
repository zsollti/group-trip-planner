import type { TripRole } from "./trips.js";

/**
 * The authorization engine (Phase 1.2) — the §3 permission matrix encoded
 * **once**, as pure functions, with no framework dependency. This is the
 * project's headline security asset: the backend guard resolves the caller's
 * role from the DB per request and calls {@link can}; the front-ends call the
 * same function to render role-conditional controls. There is no permission
 * logic anywhere else — a role's capabilities live here and only here.
 *
 * Two concerns are kept separate:
 *  - {@link can} answers "does this role hold this capability at all?" (the
 *    matrix rows), and
 *  - {@link canActOn} answers the orthogonal "strictly-lower-role" rule that
 *    governs member management (a Co-organizer may act only on roles beneath
 *    it, never the Owner or a peer).
 */

/** Every authorizable action in the domain, keyed to an SRS §3 matrix row. */
export type TripAction =
  | "trip.view" // View trip
  | "trip.edit" // Edit trip details
  | "trip.delete" // Delete trip
  | "trip.transferOwnership" // Transfer ownership
  | "trip.leave" // Leave trip (Owner must transfer first)
  | "member.manage" // Manage roles + kick/block/unblock (see canActOn)
  | "invite.create" // Create invite links
  | "category.manage" // Create/edit/delete category
  | "option.propose" // Propose/edit/delete option (proposer scope in-handler)
  | "vote.cast" // Vote on options
  | "decision.lock" // Lock/unlock a decision
  | "message.post" // Chat: post / react / @mention
  | "message.deleteOwn" // Delete own message
  | "message.deleteAny"; // Delete others' messages

/**
 * Role ranking for the strictly-lower-role rule. Higher acts on strictly
 * lower; equal or higher is never actionable. Visitor is not a role and has no
 * entry here — it never holds a membership.
 */
export const ROLE_RANK: Record<TripRole, number> = {
  OWNER: 3,
  CO_ORGANIZER: 2,
  PARTICIPANT: 1,
  GUEST: 0,
};

// The matrix, transcribed from SRS §3 as a set of roles per action. A role is
// present iff its cell is a ✅. Nuances that need a *target* (Co-org "lower
// only", Participant "own option", "own message") are NOT expressed here — they
// are the job of canActOn / in-handler ownership checks. `can` only answers the
// coarse "has this capability at all" question.
const MATRIX: Record<TripAction, ReadonlySet<TripRole>> = {
  "trip.view": new Set(["OWNER", "CO_ORGANIZER", "PARTICIPANT", "GUEST"]),
  "message.post": new Set(["OWNER", "CO_ORGANIZER", "PARTICIPANT", "GUEST"]),
  "message.deleteOwn": new Set([
    "OWNER",
    "CO_ORGANIZER",
    "PARTICIPANT",
    "GUEST",
  ]),
  "message.deleteAny": new Set(["OWNER", "CO_ORGANIZER"]),
  "vote.cast": new Set(["OWNER", "CO_ORGANIZER", "PARTICIPANT"]),
  "option.propose": new Set(["OWNER", "CO_ORGANIZER", "PARTICIPANT"]),
  "decision.lock": new Set(["OWNER", "CO_ORGANIZER"]),
  "trip.edit": new Set(["OWNER", "CO_ORGANIZER"]),
  "category.manage": new Set(["OWNER", "CO_ORGANIZER"]),
  "invite.create": new Set(["OWNER", "CO_ORGANIZER"]),
  "member.manage": new Set(["OWNER", "CO_ORGANIZER"]),
  "trip.transferOwnership": new Set(["OWNER"]),
  "trip.delete": new Set(["OWNER"]),
  // Owner cannot leave directly — they must transfer or delete first (FR-12).
  "trip.leave": new Set(["CO_ORGANIZER", "PARTICIPANT", "GUEST"]),
};

/**
 * Does `role` hold `action` as a capability? Pure, total, and the single source
 * of truth for the permission matrix. Target-scoped rules (strictly-lower,
 * proposer-owns) are layered on top by {@link canActOn} and handler checks —
 * never re-encode any of this elsewhere.
 */
export function can(role: TripRole, action: TripAction): boolean {
  return MATRIX[action].has(role);
}

/**
 * The strictly-lower-role rule for member management (SRS §3): an actor may
 * change the role of / kick / block / unblock a target **only** if the actor
 * can manage members *and* outranks the target. This closes the
 * privilege-escalation and coup paths — a Co-organizer can never act on the
 * Owner or another Co-organizer, and no one can act on a peer.
 */
export function canActOn(actorRole: TripRole, targetRole: TripRole): boolean {
  return (
    can(actorRole, "member.manage") &&
    ROLE_RANK[actorRole] > ROLE_RANK[targetRole]
  );
}

/**
 * May `actorRole` *assign* `newRole` to a member (Phase 1.4 role change)? The
 * mirror of {@link canActOn} for the promotion target: an actor may only set a
 * member to a role **strictly below its own** — so a Co-organizer can grant
 * Guest/Participant but never mint a peer Co-organizer, and OWNER is never
 * assignable this way (ownership moves only by explicit transfer). A complete
 * role change is gated by *both* checks: `canActOn(actor, currentRole)` (the
 * actor outranks who they're changing) **and** `canAssignRole(actor, newRole)`
 * (the actor outranks the role they're granting).
 */
export function canAssignRole(actorRole: TripRole, newRole: TripRole): boolean {
  return (
    can(actorRole, "member.manage") && ROLE_RANK[actorRole] > ROLE_RANK[newRole]
  );
}

/**
 * May `actorRole` edit or soft-delete an option (Phase 2.2)? The target-scoped
 * "own option / any option" rule (SRS §3): the **proposer** may manage their own
 * option as long as they still hold the propose capability (a demoted Guest
 * cannot), and an **Organizer** (Owner/Co-organizer) may manage *any* option.
 * The coarse `option.propose` capability is checked by the route guard; this
 * layers the ownership nuance on top, the same way {@link canActOn} does for
 * member management. Locked-option and Active-trip rules are separate concerns
 * enforced by the caller.
 */
export function canManageOption(
  actorRole: TripRole,
  isProposer: boolean,
): boolean {
  if (isProposer && can(actorRole, "option.propose")) return true;
  return ROLE_RANK[actorRole] >= ROLE_RANK.CO_ORGANIZER;
}
