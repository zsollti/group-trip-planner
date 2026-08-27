import { z } from "zod";
import { OptionParticipantView, OptionVoterView } from "./votes.js";
import {
  currencySchema,
  endNotBeforeStart,
  optionalAmount,
  optionalDateTime,
  optionalText,
  optionalUrl,
} from "./field-schemas.js";

/**
 * Options contract (Phase 2.2, SRS §6 / FR-21–23) — the shared source of truth
 * for proposing, editing, and soft-deleting the options that live inside a
 * category. The backend validates requests with these schemas; the three
 * front-ends drive the option cards and the propose/edit form from the inferred
 * types.
 *
 * The **material-change rule** ({@link hasMaterialChange}) lives here as a pure,
 * unit-tested function — the single definition of which edits are "material"
 * (cost- or date-affecting) and therefore flag prior votes stale (FR-23,
 * decision 3). The backend calls it to decide whether to stamp
 * `materialChangedAt`; there is no second copy of that rule.
 */

/** How `amount` is read against headcount (SRS FR-26). */
export const CostType = z.enum(["PER_PERSON", "TOTAL"]);
export type CostType = z.infer<typeof CostType>;

/**
 * Who an option is priced for (post-launch, replacing the fixed headcount).
 *
 * `WHOLE_GROUP` is the default and the overwhelmingly common case — it resolves
 * to the trip's live member count, exactly as a dynamic headcount did.
 * `OPT_IN` prices the option for the members who said they are in, and is for
 * the thing three of five people want.
 *
 * The pair it replaced was a number plus a flag: "priced for 4", where nobody
 * could say *which* 4 and nothing noticed when one of them left the trip. That
 * is why the old model needed a staleness rule at all. A list of members needs
 * none — someone who leaves takes their row with them.
 */
export const ParticipationMode = z.enum(["WHOLE_GROUP", "OPT_IN"]);
export type ParticipationMode = z.infer<typeof ParticipationMode>;

/** Option lifecycle: proposed, or the locked decision state (Phase 2.4). */
export const OptionStatus = z.enum(["PROPOSED", "LOCKED"]);
export type OptionStatus = z.infer<typeof OptionStatus>;

/**
 * Longest an option title may be (characters). Short on purpose: a title is a
 * card label on a lane, not a description — the `description` field carries the
 * detail. The board truncates it further for display (`DISPLAY_NAME_LENGTH`).
 */
export const OPTION_TITLE_MAX_LENGTH = 32;

/** Option title: required, human-facing, bounded. */
export const optionTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(OPTION_TITLE_MAX_LENGTH);

/**
 * Longest the notes may be, and the longest a link may be.
 *
 * Named rather than written into the schema, because the form has to say the
 * same number: a character counter under the box is a promise about where the
 * server will stop, and a promise made by a literal typed in a second file is
 * one that drifts the first time either moves.
 */
export const OPTION_DESCRIPTION_MAX_LENGTH = 2000;
export const OPTION_URL_MAX_LENGTH = 2000;

// `isHttpUrl` moved to `field-schemas.ts` when personal items needed the same
// scheme rule. Re-exported here because the render side has always imported it
// from this module's public surface, and that path should not move with it.
export { isHttpUrl } from "./field-schemas.js";

/**
 * The editable body of an option, shared by create and update. One cross-field
 * rule left: if both dates are given, **end must not precede start**.
 *
 * The other rule was "a fixed headcount needs a number", which went with the
 * number. Participation is not something the proposer types — it is a mode plus
 * whatever the group says, so there is nothing here that can disagree with
 * itself.
 */
const optionBody = z.object({
  title: optionTitleSchema,
  description: optionalText(OPTION_DESCRIPTION_MAX_LENGTH),
  url: optionalUrl(OPTION_URL_MAX_LENGTH),
  amount: optionalAmount,
  currency: currencySchema,
  costType: CostType.default("PER_PERSON"),
  participationMode: ParticipationMode.default("WHOLE_GROUP"),
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
  externalRef: optionalText(200),
});

const withCrossFieldRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((val: z.infer<typeof optionBody>, ctx) =>
    endNotBeforeStart(val, ctx),
  );

/** Propose a new option (Participant+; allowed unverified; not Guest/Visitor). */
export const CreateOptionInput = withCrossFieldRules(optionBody);
export type CreateOptionInput = z.infer<typeof CreateOptionInput>;

/**
 * Edit an option (proposer or Organizer). Carries the `version` the client last
 * saw — a stale version is a 409 "reload"; a **locked** option is rejected until
 * unlocked (FR-24). A full-object replace: an omitted optional field clears it.
 */
export const UpdateOptionInput = withCrossFieldRules(
  optionBody.extend({ version: z.number().int().nonnegative() }),
);
export type UpdateOptionInput = z.infer<typeof UpdateOptionInput>;

/**
 * Reorder a category's options (Organizers, Phase 3.5). Mirrors
 * {@link ReorderCategoriesInput}: the client sends the full set of the category's
 * live option ids in the desired order and the backend assigns `position` by
 * index in one transaction. Sending the complete set makes the write idempotent
 * and gap-free — a partial or padded list is rejected. Reordering is
 * **display-only**; it never changes votes, cost, or the projection.
 */
export const ReorderOptionsInput = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderOptionsInput = z.infer<typeof ReorderOptionsInput>;

/**
 * An option as shown on the planning surface. `amount` is a plain number (the DB
 * decimal, normalised) or null when unpriced. `materialChangedAt` drives the
 * stale-vote indicator (Phase 2.3). `proposerId` lets the front-ends resolve the
 * proposer-scoped edit/delete controls via `canManageOption`.
 *
 * The vote fields are the **public** approval tally (FR-22): `voteCount` and the
 * `voters` list (each carrying its own `stale` flag) are visible to every member;
 * `viewerHasVoted` is the caller's own toggle state. A freshly proposed option
 * has zero votes. When `status` is `LOCKED`, `lockedByName`/`lockedAt` name who
 * recorded the decision and when (Phase 2.4); both are null while proposed.
 */
export const OptionView = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  costType: CostType,
  participationMode: ParticipationMode,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  externalRef: z.string().nullable(),
  status: OptionStatus,
  version: z.number().int().nonnegative(),
  proposerId: z.string().uuid(),
  proposerName: z.string(),
  materialChangedAt: z.string().nullable(),
  createdAt: z.string(),
  lockedByName: z.string().nullable(),
  lockedAt: z.string().nullable(),
  voteCount: z.number().int().nonnegative(),
  voters: z.array(OptionVoterView),
  viewerHasVoted: z.boolean(),
  /**
   * Who is in, when `participationMode` is `OPT_IN` — public, like the vote
   * tally, because the whole point is that a headcount is now something anyone
   * can check. Always empty for a `WHOLE_GROUP` option: everyone is in, and
   * listing the entire trip against every card would say nothing.
   */
  participants: z.array(OptionParticipantView),
  /** The caller's own toggle state, mirroring `viewerHasVoted`. */
  viewerIsParticipant: z.boolean(),
  /**
   * How many people this option is actually priced for — the participant count
   * under `OPT_IN`, the trip's live member count under `WHOLE_GROUP`.
   *
   * Resolved by the server rather than left to each front-end, because the same
   * arithmetic decides the cost totals and two answers to "how many" is exactly
   * the drift the fixed headcount used to cause.
   */
  effectiveHeadcount: z.number().int().nonnegative(),
});
export type OptionView = z.infer<typeof OptionView>;

/**
 * The cost- and date-affecting fields whose change makes an edit "material"
 * (FR-23, decision 3) — NOT title/description/url/externalRef. A snapshot of
 * these is compared before/after an edit; a difference stamps `materialChangedAt`
 * and flags prior votes stale.
 */
export interface OptionMaterialSnapshot {
  readonly amount: number | null;
  readonly currency: string;
  readonly costType: CostType;
  /**
   * The **mode**, and deliberately not the participant list.
   *
   * Switching an option between "everyone" and "who's in?" is an edit by the
   * proposer that changes what every prior vote was cast about, so it is
   * material. Somebody joining or leaving is not an edit at all — it is the
   * group using the feature, and flagging every vote stale each time a person
   * clicked would make the stale marker meaningless inside a day. The faces on
   * the card are how a change in who is in gets disclosed.
   */
  readonly participationMode: ParticipationMode;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

/**
 * Did a material (cost/date) field change between two snapshots? Pure and total —
 * the single definition of "material edit" (FR-23). Title, description, url, and
 * externalRef are deliberately excluded: cosmetic edits never invalidate votes.
 */
export function hasMaterialChange(
  before: OptionMaterialSnapshot,
  after: OptionMaterialSnapshot,
): boolean {
  return (
    before.amount !== after.amount ||
    before.currency !== after.currency ||
    before.costType !== after.costType ||
    before.participationMode !== after.participationMode ||
    before.startsAt !== after.startsAt ||
    before.endsAt !== after.endsAt
  );
}
