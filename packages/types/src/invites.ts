import { z } from "zod";
import { CategoryBuiltinKey, CategoryPaletteKey } from "./categories.js";
import { CostType } from "./options.js";
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

/**
 * Create an invite link.
 *
 * **A personal link requires an address, and is bound to it.** It used to be
 * optional and purely a delivery detail — the system mailed the link there and
 * then anyone holding the URL could redeem it, which made "personal" a
 * statement about how it was *sent* rather than about who it was for. A link
 * forwarded, pasted into a group chat or read out of a shared inbox let a
 * stranger into the board at the role it granted. Single-use only decided
 * which stranger.
 *
 * The address is still ignored for a global link, which is broadcast by
 * definition.
 *
 * A cross-field rule rather than two schemas, because the kinds share every
 * other field and a caller building one is choosing a `type`, not a shape.
 */
export const CreateInviteInput = z
  .object({
    type: InviteType,
    role: InviteRole.default("PARTICIPANT"),
    email: z
      .string()
      .trim()
      .email()
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.type !== "PERSONAL" || Boolean(v.email), {
    path: ["email"],
    message: "A personal link needs the address it is for.",
  });
export type CreateInviteInput = z.infer<typeof CreateInviteInput>;

/**
 * An invite link as shown in the management UI. `token` is included so a global
 * link can be re-displayed and copied; the front-end composes the shareable URL
 * from it. `disabledAt`/`consumedAt` are what the board reads to decide a link
 * is spent and stops listing it.
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
 * Whether this caller may redeem this link.
 *
 * Pure, and here rather than in the service, for the same reason
 * {@link resolveJoin} is: it is a rule about who a link is for, and a rule
 * stated once cannot be enforced differently in two places.
 *
 * **A null binding is not a failure to bind — it is a link from before links
 * were bound, and it stays open.** Refusing those would break invites that are
 * live right now, in inboxes, sent by people who had no way to know. The bar
 * applies to every link written from here on, which is every link that will
 * ever be created again.
 *
 * Compared case-insensitively on the trimmed value, because a domain is not
 * case-sensitive and nobody types their own capitalisation consistently. No
 * further normalisation: an invite to `ada+trips@example.com` is an invite to
 * that address, and folding plus-tags would be this app deciding it knows
 * somebody's mail routing better than they do.
 */
export function invitedAddressMatches(
  boundTo: string | null,
  callerEmail: string,
): boolean {
  if (!boundTo) return true;
  return boundTo.trim().toLowerCase() === callerEmail.trim().toLowerCase();
}

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

/**
 * What someone holding a link can see before they sign in.
 *
 * **Why this exists.** A link used to lead to a login form and nothing else, so
 * the only way to find out what you had been invited to was to make an account
 * for it. The board is the answer to "what is this", and answering it costs
 * nothing: the link is already the credential, and this shows strictly less
 * than redeeming it would.
 *
 * **What is in it, and what is deliberately not.** The trip, its lanes, the
 * options in them with their prices and dates, which are locked in, and how many
 * people voted for each. The crew by name and face, because "who is going" is
 * half of what anyone deciding wants to know.
 *
 * Not the chat, not anybody's private column, not a member's email address, not
 * the trip's budget or anyone's own, and **not who voted for what**. A tally is
 * a fact about an option; a voter list is a fact about a person, and the people
 * on this board did not agree to be read by whoever the link reaches. The role
 * the link grants is not in it either: a preview shows the trip, and every
 * reader of one is a visitor whatever the link would make them.
 */
export const InvitePreviewOption = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  /** Whether the price is per head or for the group, so it can be labelled. */
  costType: CostType,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  /** Decided. The board's padlock, as a fact rather than as an action. */
  locked: z.boolean(),
  voteCount: z.number().int().nonnegative(),
});
export type InvitePreviewOption = z.infer<typeof InvitePreviewOption>;

/** One lane, with what has been proposed in it. */
export const InvitePreviewLane = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** The lane's identity and colour, so a preview looks like the board it is. */
  builtinKey: CategoryBuiltinKey.nullable(),
  paletteKey: CategoryPaletteKey.nullable(),
  position: z.number().int().nonnegative(),
  options: z.array(InvitePreviewOption),
});
export type InvitePreviewLane = z.infer<typeof InvitePreviewLane>;

/** Somebody already going: a name and a face, and nothing to contact them by. */
export const InvitePreviewMember = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type InvitePreviewMember = z.infer<typeof InvitePreviewMember>;

export const InvitePreview = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  defaultCurrency: z.string(),
  /**
   * Whether this trip still takes people. A frozen board is worth showing and
   * not worth offering a Join button over, and the reader should be told which
   * before they make an account to find out.
   */
  acceptingMembers: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  members: z.array(InvitePreviewMember),
  lanes: z.array(InvitePreviewLane),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

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
