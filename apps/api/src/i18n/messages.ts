import { DEFAULT_LOCALE, type Locale } from "@gtp/types";
import { HU_EMAIL_MESSAGES, HU_SERVER_MESSAGES } from "./hu.js";

/**
 * Every message this API can put in front of a reader, and where its
 * translations go.
 *
 * **Why the server needs its own dictionary at all.** These strings reach the
 * screen through `ApiError.message` — the board renders what the API said. So a
 * translated interface with untranslated errors is a Hungarian screen that turns
 * English the moment something goes wrong, which is exactly when a reader is
 * least able to cope with it. Email is the other half: there is no client in an
 * inbox, so nothing but the server can choose that language.
 *
 * **Why the English text is the key**, rather than `trip.notFound` codes at the
 * throw sites. The alternative was rewriting all 89 `throw new
 * NotFoundException(...)` calls to carry a symbol, which would move every
 * message away from the code that raises it — and the English sentence at the
 * throw site is the best documentation those services have. So the source string
 * *is* the key, and the fragility that normally brings (reword the English and
 * the translation silently stops matching) is closed by a test: `i18n.spec.ts`
 * reads the API's own source, collects every literal exception message, and fails
 * if one is missing from {@link SERVER_MESSAGES}. A new or reworded message
 * cannot ship untranslated without someone being told.
 *
 * English has no entry anywhere here. It is the source language, so translating
 * into it is the identity — a `Record<"en", ...>` of 58 strings to themselves
 * would be 58 more chances to disagree with the code.
 */

/**
 * The inventory: every literal message the API throws, in the source language.
 *
 * This is the list a translator works from, and the list the source-scanning test
 * holds the code to. Sorted, so a diff shows what actually changed.
 *
 * Two kinds of entry:
 *
 *  - plain sentences, matched verbatim;
 *  - **patterns** carrying `{placeholders}`, thrown with {@link localizedMessage}
 *    so the values travel beside the pattern instead of being baked into it. A
 *    message that interpolated at the throw site could never be looked up again —
 *    "This board is at its limit of 12 categories" is not a key anybody can
 *    translate.
 */
export const SERVER_MESSAGES = [
  "A global link for this role already exists. Disable it first to make a new one.",
  "Category not found",
  "Channel not found",
  "Dates has to stay single-choice — the trip runs over one date range.",
  "Google account has no email address.",
  "Images must be {mb}MB or smaller.",
  "Invalid cursor",
  "Invalid email or password",
  "Invalid or expired verification token",
  "Invalid unsubscribe link",
  "Invalid {name}",
  "Invite link not found",
  "Member not found",
  "Message not found",
  "No file was uploaded (field name: file).",
  "No such user.",
  "Notification not found",
  "Only the proposer or an organizer can delete this option.",
  "Only the proposer or an organizer can edit this option.",
  "Option not found",
  "Please verify your email address to do this.",
  "Reorder must list each of the category's options exactly once.",
  "Reorder must list each of the trip's categories exactly once.",
  "Someone else changed this category's decision. Reload to see the current state.",
  "Someone else changed this option. Reload to see the current state.",
  "That image couldn't be processed. It may be corrupt.",
  "That member must verify their email before becoming a co-organizer.",
  "That member must verify their email before becoming the owner.",
  "The Dates category can't be deleted — it's the trip's only way to set its dates.",
  "This account has been deleted.",
  "This board is at its limit of {cap} categories. Delete one to add another.",
  "This category was changed since you opened it. Reload to see the latest.",
  "This invite link has already been used.",
  "This invite link has been disabled.",
  "This invite link is invalid.",
  "This option can no longer be locked. Reload to see the current state.",
  "This option is already locked. Reload to see the current decision.",
  "This option is locked. Unlock it before editing.",
  "This option is priced for the whole trip, so everyone is already in.",
  "This option isn't locked as you last saw it. Reload to see the current state.",
  "This option was changed since you opened it. Reload to see the latest.",
  "This trip has ended and can no longer be changed.",
  "This trip has ended and is no longer accepting new members.",
  "This trip is full.",
  "This trip was changed since you opened it. Reload to see the latest.",
  "Trip not found",
  "Verify your email address before accepting a co-organizer invite.",
  "You already own this trip.",
  "You can only assign a role below your own.",
  "You can only block members below your own role.",
  "You can only invite people to a role below your own.",
  "You can only manage members below your own role.",
  "You can only remove members below your own role.",
  "You can't delete this message",
  "You don't have permission to do this.",
  "You've been removed from this trip and can't rejoin.",
  "database unreachable",
  "“{name}” has {locked} decided options. Unlock all but one before making it single-choice.",
  "“{name}” is full at {cap} options. Remove one to propose another.",
] as const;

/**
 * The one literal message deliberately left out of the inventory.
 *
 * `AdminGuard` answers a non-operator with Express's own wording for a route that
 * does not exist — `Cannot GET /admin/overview` — precisely so the console is
 * indistinguishable from a 404 to anyone not on the list. Translating it would
 * make it distinguishable again: a localized "cannot GET" is not what a real
 * missing route says, and the whole point is that the two are the same answer.
 *
 * The source-scanning test knows about this exemption, so it stays a decision
 * rather than an omission.
 */
export const UNTRANSLATED_MESSAGES = ["Cannot "] as const;

/**
 * The prose in the four emails, which the same catalogue translates.
 *
 * Separate from {@link SERVER_MESSAGES} because the source-scanning test holds
 * that list to the API's `throw` sites, and these are not thrown — nothing in a
 * `catch` block can put them on a screen. They still need translating for a
 * stronger reason than the exceptions do: **there is no client in an inbox**, so
 * if the server does not choose the language of an email, nothing does.
 *
 * Whole sentences, with `{placeholders}` for the values. Never fragments — a
 * subject built as `t("You're invited to") + name` reads correctly in English and
 * puts the words in the wrong order in a language that arranges them differently.
 * Markup is absent for the same reason it is absent from the exception messages:
 * where a name is bold, the bold travels in the value.
 */
export const EMAIL_MESSAGES = [
  "Open the invite",
  "Open the trip",
  "Someone tried to register with this email. If it was you, just log in — no new account was created.",
  "Unsubscribe",
  "Verify my email",
  "Verify your email",
  "Welcome to Group Trip Planner. Confirm your email:",
  "You already have an account",
  "You get this because mention email is on.",
  `You're invited to "{trip}"`,
  `You've been invited to join "{trip}" on Group Trip Planner.`,
  "it only turns off notification email, never account email.",
  '{name} mentioned you in "{trip}"',
  '{name} mentioned you in "{trip}":',
] as const;

/** A message's translations, per language. English is absent by design. */
export type MessageCatalogue = Partial<
  Record<"en" | "hu", Readonly<Record<string, string>>>
>;

/**
 * The translations themselves.
 *
 * Hungarian is one object per catalogue, and that was the whole change on this side:
 * neither the renderer above nor the exception filter that calls it moved a line.
 */
export const TRANSLATIONS: MessageCatalogue = {
  hu: { ...HU_SERVER_MESSAGES, ...HU_EMAIL_MESSAGES },
};

/**
 * Render a message in a reader's language.
 *
 * Falls back to the source string whenever there is nothing better: no catalogue
 * for the language, no entry for the message, or a message the code composed at
 * runtime. An untranslated sentence is a smaller failure than a missing one, so
 * this never throws and never returns empty.
 *
 * The catalogue is a parameter so it can be exercised without one existing yet —
 * the mechanism is testable in a build that has nothing to translate into.
 */
export function translate(
  message: string,
  locale: Locale,
  catalogue: MessageCatalogue = TRANSLATIONS,
): string {
  if (locale === DEFAULT_LOCALE) return message;
  return catalogue[locale]?.[message] ?? message;
}

/**
 * Substitute `{placeholder}` values into a (possibly translated) pattern.
 *
 * Re-exported from the contract rather than implemented here: the board renders
 * its own labels with the same rule, and two copies of a substitution rule is two
 * chances for a sentence to come out differently on either side of the wire.
 */
export { interpolate } from "@gtp/types";
