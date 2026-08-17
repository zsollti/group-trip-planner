import { z } from "zod";

/**
 * The interface's language (post-launch).
 *
 * Three separate things live here, and keeping them apart is the point:
 *
 *  1. {@link LOCALES} — the languages **this build offers**. The switch renders
 *     it and the API validates against it, so a language cannot be selected
 *     before it is translated. It grows by one entry when a dictionary lands.
 *  2. {@link INTL_TAG} — the BCP-47 tag each language formats dates in. A fact
 *     about languages rather than about this app, so it may name a language
 *     `LOCALES` does not offer yet; nothing can select one of those.
 *  3. {@link resolveLocale} — how an untrusted string becomes one of ours.
 *
 * **Why the app has a language at all**, rather than following the browser: a
 * date carries words. `toLocaleDateString(undefined)` renders "Mon 17 Aug" or
 * "2026. aug. 17., hétfő" depending on who is looking, so an English-only
 * interface printed Hungarian weekday names beside English labels. Mixed-language
 * chrome is worse than either language on its own — so the app's language decides
 * its dates, and now the reader decides the app's language.
 *
 * **Money deliberately does not follow this.** `lib/money` keeps passing
 * `undefined`, so grouping and separators follow the reader's own conventions:
 * a separator is a numeric convention, not a word, and a Hungarian reader wants
 * `1 300` whichever language the labels are in. The currency code is
 * language-neutral either way.
 */

/**
 * The languages a reader can choose in this build.
 *
 * One entry today. The plumbing around it is deliberately built for more — the
 * alternative is a second pass that touches every date in the app the day a
 * dictionary arrives.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

/** What an account gets when it has never said. */
export const DEFAULT_LOCALE: Locale = "en";

/** A stored or submitted language, validated against what this build offers. */
export const localeSchema = z.enum(LOCALES);

/**
 * How each language writes its dates.
 *
 * `en-GB` rather than `en-US`: the audience is European, day-before-month is what
 * the calendar grid already draws, and it gives a 24-hour clock, which is what
 * the option form's time list offers.
 *
 * Typed against every possible language rather than only the offered ones, so
 * adding a language to {@link LOCALES} cannot compile until its tag exists here.
 */
export const INTL_TAG: Record<"en" | "hu", string> = {
  en: "en-GB",
  hu: "hu-HU",
};

/**
 * Each language's name **in that language**.
 *
 * An endonym, always: a reader looking for their own language scans for the word
 * they would use for it, and "Hungarian" is of no help to someone who cannot
 * read the rest of the screen.
 */
export const LOCALE_LABEL: Record<"en" | "hu", string> = {
  en: "English",
  hu: "Magyar",
};

/** The BCP-47 tag to format a language's dates and times with. */
export function intlTagFor(locale: Locale): string {
  return INTL_TAG[locale];
}

/**
 * Substitute `{placeholder}` values into a (possibly translated) pattern.
 *
 * Lives in the contract because both sides need exactly this: the API renders
 * exception messages and email prose with it, and the board renders its own
 * labels. Two copies of a substitution rule is two chances for a sentence to come
 * out differently on either side of the wire.
 *
 * Deliberately dumb: it replaces the placeholders it is given and leaves anything
 * else alone. A translation that drops a placeholder loses a value rather than
 * breaking a page, and one that invents a placeholder shows the brace — both
 * visible in review, neither fatal at runtime.
 */
export function interpolate(
  pattern: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  let out = pattern;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

/**
 * Narrow an untrusted language string to one this build offers.
 *
 * Accepts what the three real sources actually send: a stored column (`"en"`), a
 * browser's `navigator.language` (`"en-GB"`), and an `Accept-Language` header
 * (`"hu-HU,hu;q=0.9,en;q=0.8"`). So it reads a *list*, in order, and takes the
 * first entry whose primary subtag is one of ours — which is what makes the
 * header usable for the pre-auth screens and for email to a reader with no
 * account yet.
 *
 * Quality values are honoured only as ordering. A client that lists its
 * preferences out of order is vanishingly rare and the cost of being wrong is
 * one screen in the wrong language, so this stays a scan rather than a sort.
 *
 * Never throws and never returns null: an unreadable preference is not an error,
 * it is an absent one, and {@link DEFAULT_LOCALE} is the answer.
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  if (!candidate) return DEFAULT_LOCALE;
  for (const part of candidate.split(",")) {
    // Drop the q-value, then the region: "hu-HU;q=0.9" → "hu".
    const primary = part.split(";")[0]?.trim().split("-")[0]?.toLowerCase();
    const match = LOCALES.find((l) => l === primary);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
