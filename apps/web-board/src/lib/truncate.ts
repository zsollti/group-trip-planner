/**
 * Display truncation for user-entered names.
 *
 * The contract caps a category name and an option title at 32 characters
 * (`CATEGORY_NAME_MAX_LENGTH` / `OPTION_TITLE_MAX_LENGTH`), but the board shows
 * those names in *compact, repeating* positions — a lane header on a row of
 * lanes, a card title, a chat chip — where 32 characters blow the layout out.
 * So the stored value stays full-length and the tight positions render a
 * shortened one.
 *
 * Counted in characters rather than measured in pixels (no CSS `text-overflow`)
 * for two reasons: the rule is specified per character, and jsdom does no layout
 * — a width-based rule is untestable in this repo (`docs/ui-audit.md`, "Known
 * limits"), a character-based one is exact.
 *
 * Callers must keep the **full** value on `title` (and in any `aria-label`) so
 * nothing is actually lost: a screen reader should never hear an ellipsis, and a
 * pointer user can hover for the rest. `OptionDetail` is deliberately exempt —
 * it is the one surface that shows a name whole.
 */

/** How many characters of a name the compact positions show. */
export const DISPLAY_NAME_LENGTH = 15;

/**
 * `value` shortened to `max` characters plus an ellipsis, or returned untouched
 * when it already fits. A trailing space before the ellipsis is trimmed, so
 * "Museums and galleries" reads "Museums and…" rather than "Museums and …".
 */
export function truncateName(
  value: string,
  max: number = DISPLAY_NAME_LENGTH,
): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

/**
 * Whether {@link truncateName} would shorten `value` — i.e. whether the rendered
 * text is lossy and the caller therefore owes the reader a `title` tooltip.
 */
export function isTruncated(
  value: string,
  max: number = DISPLAY_NAME_LENGTH,
): boolean {
  return value.length > max;
}
