import { Fragment, createElement, type ReactNode } from "react";
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

/**
 * A translated sentence with **React nodes** in its placeholders.
 *
 * For the sentences that wrap part of themselves in markup — "We've sent a link to
 * **you@example.com** — open it and you're set" — where the address is bold and
 * the rest is not.
 *
 * The server solves the same problem by carrying the markup inside the value
 * (`{ name: "<strong>Ada</strong>" }`), which works because an email body is a
 * string. React escapes strings by design, so that trick cannot cross over: the
 * reader would see the tag. The alternative everybody reaches for first is
 * splitting the sentence at the markup and translating the halves — and that is
 * precisely what must not happen, because a translator handed "We've sent a link
 * to" and "— open it and you're set" separately cannot move the address to where
 * their language puts it.
 *
 * So the sentence stays whole in the catalogue, and this splits the *translated*
 * text on its placeholders and drops the nodes into the gaps. Word order therefore
 * follows the translation rather than the JSX.
 *
 * Built with `createElement` rather than JSX so this module stays a `.ts` file —
 * every string in the app imports from here, and there is no reason for that to
 * depend on the JSX transform.
 */
export function tNode(
  pattern: string,
  params: Readonly<Record<string, ReactNode>>,
): ReactNode {
  const translated = translateUi(pattern, activeLocale());
  // The capture group keeps the delimiters, so the pieces alternate text/token.
  const pieces = translated.split(/(\{[A-Za-z0-9_]+\})/g);
  return createElement(
    Fragment,
    null,
    ...pieces.map((piece, i) => {
      const token = /^\{([A-Za-z0-9_]+)\}$/.exec(piece);
      // An unknown token is left as written, the same way `interpolate` leaves it:
      // a visible `{brace}` is a review-time bug, not a runtime one.
      if (!token || !(token[1]! in params)) return piece;
      return createElement(
        Fragment,
        { key: `${token[1]}-${i}` },
        params[token[1]!],
      );
    }),
  );
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
