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
 */
export const CategoryBuiltinKey = z.enum([
  "DATES",
  "TRANSPORT",
  "ACCOMMODATION",
  "ACTIVITIES",
  "BUDGET",
]);
export type CategoryBuiltinKey = z.infer<typeof CategoryBuiltinKey>;

/** Category name: required, human-facing, bounded. */
export const categoryNameSchema = z.string().trim().min(1).max(80);

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
 * Create a custom category (Organizers). `singleChoice` defaults to multi-select
 * — the common case for a user-added bucket of proposals; the creator opts into
 * single-choice explicitly.
 */
export const CreateCategoryInput = z.object({
  name: categoryNameSchema,
  singleChoice: z.boolean().default(false),
});
export type CreateCategoryInput = z.infer<typeof CreateCategoryInput>;

/**
 * Rename a category (Organizers), carrying the `version` the client last saw.
 * The backend rejects the write with a 409 if the category changed since (SRS
 * §6 optimistic concurrency — the "changed since you opened it — reload" path).
 */
export const RenameCategoryInput = z.object({
  name: categoryNameSchema,
  version: z.number().int().nonnegative(),
});
export type RenameCategoryInput = z.infer<typeof RenameCategoryInput>;

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
 * The five built-in categories every trip is seeded with, in display order (SRS
 * §6). The `singleChoice` defaults encode the domain: a trip settles on **one**
 * date range, **one** place to stay, and **one** budget (single-choice), but may
 * keep several transport legs and many activities (multi-select) — FR-19 pins
 * Dates single-choice and Transport multi-select; the rest follow the same
 * "is there one right answer?" reading. This is the single definition of the
 * seed; the trip-creation transaction writes exactly these rows.
 */
export const BUILTIN_CATEGORIES: readonly BuiltinCategorySeed[] = [
  { builtinKey: "DATES", name: "Dates", singleChoice: true, position: 0 },
  {
    builtinKey: "TRANSPORT",
    name: "Transport",
    singleChoice: false,
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
    singleChoice: false,
    position: 3,
  },
  { builtinKey: "BUDGET", name: "Budget", singleChoice: true, position: 4 },
];
