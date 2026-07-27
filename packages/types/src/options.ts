import { z } from "zod";
import { OptionVoterView } from "./votes.js";

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

/** Option lifecycle: proposed, or the locked decision state (Phase 2.4). */
export const OptionStatus = z.enum(["PROPOSED", "LOCKED"]);
export type OptionStatus = z.infer<typeof OptionStatus>;

/** Option title: required, human-facing, bounded. */
export const optionTitleSchema = z.string().trim().min(1).max(120);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * Optional URL (proposal link / booking hook). Empty normalises to undefined.
 *
 * `.url()` alone is **not** a scheme check: it delegates to `new URL()`, which
 * happily parses `javascript:alert(1)` and `data:text/html,…`. This value is
 * rendered straight into an `href` on the board, so the scheme is constrained
 * here at the boundary rather than trusted downstream (Phase 7.2). React 19
 * does currently neutralise `javascript:` hrefs on its own, but that is the
 * renderer being defensive, not the contract being correct — and it protects
 * only consumers that happen to be React.
 */
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine(isHttpUrl, { message: "Must be an http(s) link" })
    .optional(),
);

/** True only for absolute `http:`/`https:` URLs. Shared with the render side so
 * one rule governs both what may be stored and what may be linked. */
export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** Optional non-negative money amount; blank/NaN normalises to undefined. */
const optionalAmount = z.preprocess(
  (v) =>
    v === "" || v === null || (typeof v === "number" && Number.isNaN(v))
      ? undefined
      : v,
  z.number().nonnegative().max(1_000_000_000).optional(),
);

/** Optional positive integer headcount; blank/NaN normalises to undefined. */
const optionalHeadcount = z.preprocess(
  (v) =>
    v === "" || v === null || (typeof v === "number" && Number.isNaN(v))
      ? undefined
      : v,
  z.number().int().positive().max(100_000).optional(),
);

/** Optional ISO date-time; empty normalises to undefined. */
const optionalDateTime = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().datetime({ offset: true }).optional(),
);

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code");

/**
 * The editable body of an option, shared by create and update. Two cross-field
 * rules: a **fixed headcount requires a number** (dynamic headcount uses the live
 * member count instead), and if both dates are given **end must not precede
 * start**.
 */
const optionBody = z.object({
  title: optionTitleSchema,
  description: optionalText(2000),
  url: optionalUrl,
  amount: optionalAmount,
  currency: currencySchema,
  costType: CostType.default("PER_PERSON"),
  headcount: optionalHeadcount,
  headcountIsFixed: z.boolean().default(false),
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
  externalRef: optionalText(200),
});

const withCrossFieldRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((val: z.infer<typeof optionBody>, ctx) => {
    if (val.headcountIsFixed && val.headcount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["headcount"],
        message: "A fixed headcount needs a number.",
      });
    }
    if (
      val.startsAt !== undefined &&
      val.endsAt !== undefined &&
      Date.parse(val.endsAt) < Date.parse(val.startsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "End must not be before start.",
      });
    }
  });

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
  headcount: z.number().int().nullable(),
  headcountIsFixed: z.boolean(),
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
  readonly headcount: number | null;
  readonly headcountIsFixed: boolean;
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
    before.headcount !== after.headcount ||
    before.headcountIsFixed !== after.headcountIsFixed ||
    before.startsAt !== after.startsAt ||
    before.endsAt !== after.endsAt
  );
}
