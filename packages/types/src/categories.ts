import { z } from "zod";

/**
 * Categories contract (Phase 2.1, SRS §6 / FR-18–20) — the shared source of
 * truth for the planning categories that hold options in later slices. The
 * backend validates requests with these schemas; the three front-ends drive the
 * category tabs/sections and the organizer-gated management UI from the inferred
 * types, so a contract change that isn't matched on both sides breaks typecheck.
 *
 * The **built-in seed set** ({@link BUILTIN_CATEGORIES}) lives here as a pure,
 * unit-tested constant — the one definition of which categories a new trip gets
 * and their default `singleChoice` flags. The backend seeds from it inside the
 * trip-creation transaction; there is no second copy of the list.
 */

/**
 * Stable identity for a built-in category (mirrors the Prisma enum). Survives a
 * rename, so it — not the mutable name — identifies the Dates category for the
 * Phase-2.5 date write-back and drives the seeded `singleChoice` defaults.
 *
 * `BUDGET` is **retired, not removed**: it is no longer seeded (see
 * {@link BUILTIN_CATEGORIES}), but trips created before it was retired still
 * carry a Budget row, and dropping the value here would make every one of those
 * categories fail to parse. It stays until those rows are gone; nothing creates
 * a new one.
 */
export const CategoryBuiltinKey = z.enum([
  "DATES",
  "TRANSPORT",
  "ACCOMMODATION",
  "ACTIVITIES",
  "BUDGET",
]);
export type CategoryBuiltinKey = z.infer<typeof CategoryBuiltinKey>;

/**
 * Longest a category name may be (characters). A name is a lane header on a
 * board that shows several lanes side by side, so it is deliberately short; the
 * board truncates it further for display (`DISPLAY_NAME_LENGTH`).
 */
export const CATEGORY_NAME_MAX_LENGTH = 32;

/** Category name: required, human-facing, bounded. */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CATEGORY_NAME_MAX_LENGTH);

/**
 * A category as shown on the trip's planning surface. `builtinKey` is non-null
 * only for the five seeded categories; `isBuiltin` gates the UI (a built-in may
 * be renamed/reordered but the front-ends flag it and never offer to delete it
 * blindly). `version` carries the optimistic-concurrency token for rename.
 */
export const CategoryView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  singleChoice: z.boolean(),
  isBuiltin: z.boolean(),
  builtinKey: CategoryBuiltinKey.nullable(),
  position: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
export type CategoryView = z.infer<typeof CategoryView>;

/**
 * Create a custom category (Organizers). `singleChoice` defaults to **true**:
 * a category is a question, and most questions have one answer. Keeping several
 * winners is the interesting case, so it is the one you opt into — and it can be
 * switched later either way ({@link UpdateCategoryInput}), which is what makes
 * the stricter default the safe one.
 */
export const CreateCategoryInput = z.object({
  name: categoryNameSchema,
  singleChoice: z.boolean().default(true),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

/**
 * Update a category's editable fields (Organizers), carrying the `version` the
 * client last saw. The backend rejects the write with a 409 if the category
 * changed since (SRS §6 optimistic concurrency — the "changed since you opened
 * it — reload" path).
 *
 * A full-object replace, not a patch: `singleChoice` is sent on every write, so
 * a rename cannot silently reset it and the two edits share one concurrency
 * token. Two rules the backend enforces and the board mirrors —
 * {@link canBeMultiSelect} pins Dates, and a switch to single-choice is refused
 * while more than one option is locked.
 */
export const UpdateCategoryInput = z.object({
  name: categoryNameSchema,
  singleChoice: z.boolean(),
  version: z.number().int().nonnegative(),
});
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInput>;

/**
 * Whether this category may hold more than one locked option.
 *
 * True for everything **except Dates**. A trip runs over one continuous span —
 * its `startDate`/`endDate` columns hold exactly one range, written from the one
 * locked Dates option — so a Dates category with two winners has no meaning the
 * rest of the app could represent. Every other question is legitimately either
 * kind: one place to stay, or three; one flight, or a leg each way.
 *
 * One definition: the API refuses the write with it, the board hides the control
 * with it.
 */
export function canBeMultiSelect(category: {
  readonly builtinKey: CategoryBuiltinKey | null;
}): boolean {
  return category.builtinKey !== "DATES";
}

/**
 * Reorder the trip's categories (Organizers). The client sends the full set of
 * category ids in the desired order; the backend assigns `position` by index in
 * one transaction. Sending the complete set makes the write idempotent and free
 * of gaps — a partial list is rejected.
 */
export const ReorderCategoriesInput = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderCategoriesInput = z.infer<typeof ReorderCategoriesInput>;

/**
 * Whether a category may be deleted. Everything is deletable **except Dates**:
 * locking a Dates option is the trip's only route to writing back its
 * start/end dates and the expiry derived from them (Phase 2.5), and
 * `@@unique([tripId, builtinKey])` means a deleted Dates category can never be
 * recreated — the trip would silently fall back to created-plus-a-year with no
 * way back. Custom categories and the other four built-ins are unaffected.
 *
 * One definition: the API enforces it, the front-end hides the control with it.
 */
export function canDeleteCategory(category: {
  readonly builtinKey: CategoryBuiltinKey | null;
}): boolean {
  return category.builtinKey !== "DATES";
}

/**
 * Whether an option form for this category should offer the cost fields
 * (amount / currency / cost-type / headcount) and a link. Dates options answer
 * "when", not "how much": their cost fields were dead weight on every form, and
 * the cost engine already ignores amount-less options, so hiding them changes
 * no totals. Custom categories keep the full form — only the built-ins carry
 * enough known intent to tailor.
 */
export function categoryOptionFields(category: {
  readonly builtinKey: CategoryBuiltinKey | null;
}): { readonly cost: boolean; readonly url: boolean; readonly dates: boolean } {
  if (category.builtinKey === "DATES") {
    return { cost: false, url: false, dates: true };
  }
  return { cost: true, url: true, dates: true };
}

/** One built-in category's seed shape (no id/version — those are DB-assigned). */
export interface BuiltinCategorySeed {
  readonly builtinKey: CategoryBuiltinKey;
  readonly name: string;
  readonly singleChoice: boolean;
  readonly position: number;
}

/**
 * The built-in categories every trip is seeded with, in display order (SRS §6).
 *
 * **All seed single-choice.** The `singleChoice` flags used to encode a guess at
 * the domain — Transport and Activities multi-select, on the reading that a trip
 * keeps several legs and many activities. The guess was half right and the shape
 * was wrong: whether a trip wants one flight or a leg each way, one hotel or a
 * different city every third night, is a property of *that* trip, not of the
 * word "Transport". Guessing per category meant guessing wrong for half of them
 * with no way to say so.
 *
 * So the seed takes the stricter reading — a category is a question, and a
 * question has an answer — and the trip changes what it needs
 * ({@link UpdateCategoryInput}). Dates is the one that cannot
 * ({@link canBeMultiSelect}): the trip has one date range, and two winners there
 * would have nothing to write back to.
 *
 * **Budget was retired from the seed.** A lane holds competing options you vote
 * between and lock one of; a budget is a *constraint*, not a candidate. Worse,
 * it was double-counting: every non-Dates option already carries cost fields and
 * `cost.ts` sums the committed total across **every** locked option in any
 * category, so locking "€800 per person" in a Budget lane added that €800 to the
 * same total as the actual flights and hotel. The trip's cost is already an
 * emergent property of the other lanes' decisions — a target to compare it
 * against belongs on the trip, not in a lane.
 */
export const BUILTIN_CATEGORIES: readonly BuiltinCategorySeed[] = [
  { builtinKey: "DATES", name: "Dates", singleChoice: true, position: 0 },
  {
    builtinKey: "TRANSPORT",
    name: "Transport",
    singleChoice: true,
    position: 1,
  },
  {
    builtinKey: "ACCOMMODATION",
    name: "Accommodation",
    singleChoice: true,
    position: 2,
  },
  {
    builtinKey: "ACTIVITIES",
    name: "Activities",
    singleChoice: true,
    position: 3,
  },
];
