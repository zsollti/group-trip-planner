/**
 * The locale the app's own dates and times are written in.
 *
 * Every `toLocaleDateString` / `toLocaleTimeString` here used to pass
 * `undefined`, which means "the reader's browser". For numbers that is right —
 * a separator is a convention, not a language, and a Hungarian reader should
 * see `1 300`. For **dates it is not**, because a date carries words: the same
 * screen rendered "Mon 17 Aug" or "2026. aug. 17., hétfő" depending on the
 * browser, so an English-only interface printed Hungarian weekday and month
 * names next to English labels, and half of a Hungarian reader's screen was
 * still in English anyway. Mixed-language chrome is worse than either language
 * on its own.
 *
 * So the app's language decides its dates. `en-GB` rather than `en-US`: the
 * trip's audience is European, day-before-month matches what the calendar grid
 * already draws, and it gives a 24-hour clock, which is what the option form's
 * time list offers.
 *
 * **Money deliberately does not use this** — `lib/money` keeps passing
 * `undefined` so grouping and separators follow the reader, which is a
 * numeric convention rather than a word. The currency *code* is language-
 * neutral either way.
 *
 * When the app is really translated this becomes the active language, and the
 * single import site is the point: one constant to change, not forty call
 * sites to find.
 */
export const UI_LOCALE = "en-GB";
