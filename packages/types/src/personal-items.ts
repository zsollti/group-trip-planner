import { z } from "zod";
import {
  currencySchema,
  endNotBeforeStart,
  optionalAmount,
  optionalDateTime,
  optionalText,
  optionalUrl,
} from "./field-schemas.js";
import {
  OPTION_DESCRIPTION_MAX_LENGTH,
  OPTION_TITLE_MAX_LENGTH,
  OPTION_URL_MAX_LENGTH,
  optionTitleSchema,
} from "./options.js";

/**
 * Personal items (post-launch) — the things **one member** is paying for and
 * planning around, that the rest of the trip never sees.
 *
 * A flight from your own city, a visa, travel insurance, the extra night you
 * are adding on the front. They are per-person by nature, nobody votes on
 * them, and putting them on the shared board would be noise in somebody else's
 * lane. Until now the app could answer "what does the group owe" and "what do
 * I owe of the group's decisions" but not the question people actually ask
 * before committing to a trip: **what does this trip cost me, all in.**
 *
 * ## Why this is not an `Option` with a visibility flag
 *
 * Two reasons, and the second is the one that settled it.
 *
 * **A lane is shared, ordered, capped state.** `Option.position` is reordered
 * by organizers, a category holds at most {@link maxCategoryOptions}, and each
 * lane owns a chat channel. Per-viewer rows inside that list make all three
 * ambiguous — whether a private item counts toward a public cap, what happens
 * when someone reorders a list containing a card they cannot see.
 *
 * **Every read path would become a leak surface.** Options are read in at
 * least four places; a viewer filter forgotten in any one of them puts
 * somebody's private row on another person's screen. A separate table is
 * always queried `{ tripId, ownerId }`, so "someone else's item" and "no such
 * item" are the same answer *by construction* rather than by a check a future
 * handler has to remember to write.
 *
 * ## What it deliberately does not have
 *
 * No `costType` and no `participationMode`: this is what *you* pay, so there
 * is no headcount to read it against and nothing to divide. No votes, no
 * `status`, no lock — it is a fact, not a proposal. And no `version`: an
 * option carries one because several people can edit it at once, while these
 * have exactly one editor. Two of your own tabs are last-write-wins, which is
 * the same bargain every other single-owner form in the app makes.
 *
 * ## The category is a tag, not a home
 *
 * {@link PersonalItemView.categoryId} is nullable and points at one of the
 * trip's lanes purely so the donut and the timeline can paint the item in that
 * lane's colour and glyph. The item lives in its own column regardless. The
 * FK is `SetNull`, so an organizer deleting a lane leaves other people's
 * private items untagged rather than destroying them — a shared action must
 * never reach into data its actor cannot even see.
 */

/**
 * The same bounds an option's fields carry, aliased under this surface's own
 * name.
 *
 * Deliberately the same numbers rather than coincidentally: a personal item is
 * a card on the same board, in the same size of column, so a reader who has
 * learned one form has learned the other. They are aliases and not fresh
 * literals so the two cannot drift — the form's character counter is a promise
 * about where the server stops, and that promise should be one value.
 */
export const PERSONAL_ITEM_TITLE_MAX_LENGTH = OPTION_TITLE_MAX_LENGTH;
export const PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH =
  OPTION_DESCRIPTION_MAX_LENGTH;
export const PERSONAL_ITEM_URL_MAX_LENGTH = OPTION_URL_MAX_LENGTH;

/**
 * The optional lane tag. `null` clears it; omitting it on an update clears it
 * too, since the body is a full replace like an option's.
 *
 * The server still has to check that the id names a category **of this trip**.
 * A uuid that parses is not a uuid that belongs here, and accepting a stranger
 * id would let a member tag their item with a lane from a trip they cannot
 * see — which is a row that quietly remembers the id of something its owner
 * was never shown.
 */
const optionalCategoryId = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().uuid().nullable().optional(),
);

/** The editable body of a personal item, shared by create and update. */
const personalItemBody = z.object({
  title: optionTitleSchema,
  description: optionalText(PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH),
  url: optionalUrl(PERSONAL_ITEM_URL_MAX_LENGTH),
  amount: optionalAmount,
  currency: currencySchema,
  categoryId: optionalCategoryId,
  startsAt: optionalDateTime,
  endsAt: optionalDateTime,
});

/** Add a personal item (any member, Guests included). */
export const CreatePersonalItemInput =
  personalItemBody.superRefine(endNotBeforeStart);
export type CreatePersonalItemInput = z.infer<typeof CreatePersonalItemInput>;

/**
 * Edit one of your own personal items. A full-object replace: an omitted
 * optional field clears it, exactly as an option edit does.
 */
export const UpdatePersonalItemInput =
  personalItemBody.superRefine(endNotBeforeStart);
export type UpdatePersonalItemInput = z.infer<typeof UpdatePersonalItemInput>;

/**
 * Reorder your own column (post-launch). Mirrors {@link ReorderOptionsInput}:
 * the client sends the full set of its live item ids in the desired order and
 * the backend assigns `position` by index in one transaction, so the write is
 * idempotent and gap-free. A partial or padded list is rejected.
 *
 * Unlike an option reorder this needs no permission beyond owning the rows —
 * there is nobody else whose view of the order could disagree with yours.
 */
export const ReorderPersonalItemsInput = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderPersonalItemsInput = z.infer<
  typeof ReorderPersonalItemsInput
>;

/**
 * A personal item as its owner sees it. There is no other way to see one.
 *
 * No `ownerId` on the view: every item that reaches a client is that client's
 * own, so a field naming the owner would be a fact the payload already states
 * by existing. Leaving it out means there is no shape in which this view can
 * describe somebody else.
 */
export const PersonalItemView = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  /** The lane whose colour and glyph this item borrows, or null if untagged. */
  categoryId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type PersonalItemView = z.infer<typeof PersonalItemView>;

/**
 * What this member is willing to spend on this trip, all in (post-launch).
 *
 * **Not the same number as `Trip.budgetPerPerson`**, and the difference is the
 * whole reason this exists. That one is the organizer's guideline for the
 * group's plan: it reads the same for everybody, and the rule the owner set is
 * that private spending is never measured against it. So the reader's own cost
 * chart had no target it could honestly draw — a ring folding someone's flight
 * home into the group's target would put them over a line the sentence beneath
 * it says they are keeping to.
 *
 * This is the target that chart can draw: the reader's own limit, against the
 * reader's own money, their private items included, seen by nobody else.
 *
 * Denominated in the trip's `defaultCurrency` and carrying no currency of its
 * own, exactly as the trip's target does — a second currency here would be a
 * second source of truth for a question the trip already answers.
 */
export const SetPersonalBudgetInput = z.object({
  /**
   * The figure, or null to clear it.
   *
   * Explicitly nullable rather than optional: this is a `PUT` of the whole
   * setting, so "no budget" has to be something a client can *say*. An omitted
   * field would make clearing it indistinguishable from forgetting it.
   */
  amount: z.number().nonnegative().max(1_000_000_000).nullable(),
});
export type SetPersonalBudgetInput = z.infer<typeof SetPersonalBudgetInput>;

/** The caller's own budget on a trip. Always theirs; never anybody else's. */
export const PersonalBudgetView = z.object({
  /** Null when they have not set one, which is every membership by default. */
  amount: z.number().nullable(),
  /** The trip's currency, restated so a client need not fetch the trip to write the figure. */
  currency: z.string(),
});
export type PersonalBudgetView = z.infer<typeof PersonalBudgetView>;
