import {
  DEFAULT_LOCALE,
  intlTagFor,
  resolveLocale,
  type Locale,
} from "@gtp/types";

/**
 * The language the app is currently written in.
 *
 * This used to be `export const UI_LOCALE = "en-GB"` — one constant, imported by
 * fourteen files, with a note saying that when the app was really translated this
 * would become the active language and the single import site was the point. This
 * is that change.
 *
 * **Why a module-level variable and not only React context.** Roughly half the
 * date formatting in the app happens in pure functions — `monthGrid`,
 * `timeOfDay`, `optionFormat`, and a `when()` helper at the top of four route
 * files. Threading a locale parameter through all of them would put an argument
 * on functions whose callers do not otherwise care, and a hook cannot be called
 * from any of them. So the active language is held here, and read through
 * {@link intlTag}.
 *
 * That is a mutable global, which is normally a smell. It is not one here for a
 * specific reason: **a document has exactly one language**. There is no second
 * reader on the page to disagree with, no request context to confuse it with, and
 * nothing else in the process. The one real hazard is ordering — a component
 * formatting a date before the language is known — and that is why
 * {@link setActiveLocale} is called during the provider's render rather than in
 * an effect, so it is already correct the first time anything below it renders.
 *
 * Components should prefer `useLocale()` (see `LocaleProvider`), which
 * re-renders them when the language changes. `intlTag()` alone does not: it reads
 * the current value, so a component that only calls it will keep its old dates
 * until something else re-renders it. That is exactly why the provider sets state
 * *and* this variable — the state is what repaints the tree.
 */
let active: Locale = DEFAULT_LOCALE;

/** Set the app's language. Called by `LocaleProvider`, and by tests. */
export function setActiveLocale(locale: Locale): void {
  active = locale;
}

/** The app's language right now. */
export function activeLocale(): Locale {
  return active;
}

/**
 * The BCP-47 tag to hand `toLocaleDateString` and friends.
 *
 * A function rather than a constant, which is the whole point of the change: an
 * imported constant is read once when the module loads, so it could never follow
 * a reader who switched language.
 */
export function intlTag(): string {
  return intlTagFor(active);
}

/**
 * The language to start in before the session has loaded.
 *
 * Read from `localStorage`, falling back to the browser's own preference. This
 * matters for the screens *outside* the session — sign-in, register, verify, the
 * invite-join page — which have no account to read a preference from and would
 * otherwise always be English for everybody.
 *
 * `resolveLocale` does the narrowing, so a stored value from a build that offered
 * more languages than this one degrades to the default instead of rendering a
 * language that no longer exists here.
 */
export const LOCALE_STORAGE_KEY = "gtp.locale";

export function storedLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved) return resolveLocale(saved);
  } catch {
    // A browser with storage disabled is not a broken app, just one that cannot
    // remember. Fall through to the navigator.
  }
  return resolveLocale(
    typeof navigator === "undefined" ? null : navigator.language,
  );
}

/** Remember the reader's language for the next visit, and for the pre-auth screens. */
export function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Same as above: nothing to do, and nothing worth telling the reader.
  }
}
