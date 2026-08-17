import { DEFAULT_LOCALE, interpolate, type Locale } from "@gtp/types";
import { activeLocale } from "./locale";
import { UI_TRANSLATIONS } from "./ui-messages";

/**
 * The board's own words, in the reader's language.
 *
 * **The English sentence is the key.** The same decision as the server's
 * catalogue, for the same reasons: the alternative is naming three hundred and
 * forty-six keys, and a screen full of `t("dashboard.onboard.lead")` cannot be
 * read — a reviewer would have to hold a dictionary open beside the JSX to know
 * what the page says. With the source string in place, the component still reads
 * like prose. The fragility that normally brings (reword the English, orphan the
 * translation) is closed the same way too: `i18n.test.ts` scans the board's own
 * source and fails if a `t("…")` call is missing from {@link UI_MESSAGES}.
 *
 * **A plain function, not a `useT()` hook.** The plan called for a hook; a hook
 * cannot be called from the places a third of these strings live — module-level
 * helpers like `costSummary`, `timelineLabel` and the `when()` formatters, and
 * event handlers that build an error message. Making it a hook would have meant
 * either passing `t` down as an argument through those, or leaving them
 * untranslated. It reads the active language the same way `intlTag()` does, and
 * for the same reason (see `lib/locale`): one document, one language.
 *
 * Re-rendering is still React's job and still works — `LocaleProvider` holds the
 * language in state, so changing it re-renders the tree and every `t()` call in it
 * runs again.
 *
 * **The one hazard**, and it is worth knowing: a `t()` call evaluated at *module
 * scope* would freeze the language at import time. `const TITLE = t("Boards")` is
 * therefore wrong, and `function Title() { return t("Boards"); }` is right. There
 * are none of the former today, and none of these strings has a reason to be a
 * module constant.
 */
export function t(
  message: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  return interpolate(translateUi(message, activeLocale()), params);
}

/** The lookup on its own, so a test can drive it without touching the module state. */
export function translateUi(message: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return message;
  return UI_TRANSLATIONS[locale]?.[message] ?? message;
}

/**
 * Pick the singular or plural wording for a count.
 *
 * **The rule is per language, and Hungarian is why this function exists.** English
 * agrees with the number: one member, two members. Hungarian does not — after a
 * numeral the noun stays singular (`2 tag`, never `2 tagok`), so the "plural" form
 * of a counted phrase is the singular one. A naive `count === 1 ? one : many`
 * would put a plural noun after every Hungarian numeral, which is the kind of
 * mistake that makes a translation read as machine output.
 *
 * Both forms are ordinary catalogue entries carrying `{n}`, so a translator sees
 * two whole phrases rather than a stem and a suffix.
 */
export function plural(
  count: number,
  one: string,
  many: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const form = pickForm(activeLocale(), count) === "one" ? one : many;
  return t(form, { n: count, ...params });
}

/** Which wording a language uses for a count. */
export function pickForm(locale: Locale, count: number): "one" | "many" {
  // Hungarian: a numeral is already the plural marker, so the noun does not
  // repeat it. Every counted phrase therefore takes the singular wording.
  if ((locale as string) === "hu") return "one";
  return count === 1 ? "one" : "many";
}
