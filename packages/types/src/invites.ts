import { z } from "zod";
import { TripRole } from "./trips.js";
import { ROLE_RANK } from "./permissions.js";

/**
 * Invites contract (Phase 1.3) — the shared source of truth for creating,
 * listing, and redeeming invite links (SRS FR-13–16). The backend validates
 * requests with these schemas; the front-ends drive the invite-management UI and
 * the `/join/:token` landing from the inferred types.
 *
 * The **join-resolution logic** ({@link resolveJoin}) lives here as a pure,
 * unit-tested function — the idempotent / upgrade-never-downgrade rule (FR-16)
 * encoded once, the same way the permission matrix is. The backend calls it to
 * decide what a redemption does; there is no join logic anywhere else.
 */

/** Link kind (SRS FR-13). Global = reusable/disableable; personal = single-use. */
export const InviteType = z.enum(["GLOBAL", "PERSONAL"]);
export type InviteType = z.infer<typeof InviteType>;

/**
 * The roles an invite link may grant (SRS FR-14). OWNER is never invitable —
 * ownership only moves by explicit transfer (Phase 1.4). Defaults to Participant.
 */
export const InviteRole = z.enum(["GUEST", "PARTICIPANT", "CO_ORGANIZER"]);
export type InviteRole = z.infer<typeof InviteRole>;

/** Create an invite link. `email` is only meaningful for a personal link (the
 * address the system emails it to); it is ignored for a global link. */
export const CreateInviteInput = z.object({
  type: InviteType,
  role: InviteRole.default("PARTICIPANT"),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInput>;

/**
 * An invite link as shown in the management UI. `token` is included so a global
 * link can be re-displayed and copied; the front-end composes the shareable URL
 * from it. `disabledAt`/`consumedAt` drive the link's status chips.
 */
export const InviteLinkView = z.object({
  id: z.string().uuid(),
  type: InviteType,
  role: TripRole,
  token: z.string(),
  sentToEmail: z.string().nullable(),
  disabledAt: z.string().nullable(),
  consumedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InviteLinkView = z.infer<typeof InviteLinkView>;

/**
 * Result of redeeming a token at `/join/:token`. `alreadyMember` distinguishes a
 * fresh join/upgrade from an idempotent no-op so the UI can word its toast; the
 * front-end navigates to `/trips/:tripId` regardless.
 */
export const JoinTripResult = z.object({
  tripId: z.string().uuid(),
  role: TripRole,
  alreadyMember: z.boolean(),
});
export type JoinTripResult = z.infer<typeof JoinTripResult>;

/** What redeeming a link does, given the caller's current membership. */
export type JoinAction = "JOIN" | "UPGRADE" | "NOOP";

export interface JoinResolution {
  /** JOIN = create membership; UPGRADE = raise an existing member's role; NOOP =
   * already a member at an equal-or-higher role (idempotent open). */
  readonly action: JoinAction;
  /** The caller's role after redemption. */
  readonly resultRole: TripRole;
}

/**
 * The idempotent / upgrade-never-downgrade rule (SRS FR-16), encoded once as a
 * pure function. Given the caller's current role (`null` if not yet a member)
 * and the role a link grants:
 *  - not a member          → **JOIN** at the link's role;
 *  - member, link outranks → **UPGRADE** to the link's role;
 *  - member, link equal/below → **NOOP** (keep the current, higher-or-equal role).
 *
 * A link never downgrades a member. History-trip refusal, disabled/consumed
 * links, blocks, and the verified-email gate for a Co-organizer grant are
 * separate concerns enforced by the caller — this function answers only "what
 * does the role become".
 */
export function resolveJoin(
  currentRole: TripRole | null,
  linkRole: TripRole,
): JoinResolution {
  if (currentRole === null) {
    return { action: "JOIN", resultRole: linkRole };
  }
  if (ROLE_RANK[linkRole] > ROLE_RANK[currentRole]) {
    return { action: "UPGRADE", resultRole: linkRole };
  }
  return { action: "NOOP", resultRole: currentRole };
}
