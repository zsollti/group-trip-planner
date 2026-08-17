import { useEffect, type ReactNode } from "react";
import { setApiLanguage, useAuth } from "@gtp/api-client";
import { intlTagFor } from "@gtp/types";
import {
  activeLocale,
  rememberLocale,
  setActiveLocale,
  storedLocale,
} from "../lib/locale";
import { LocaleContext } from "../lib/useLocale";

/**
 * Puts the reader's language into the tree, and into the module that the app's
 * pure date helpers read.
 *
 * Where the language comes from, in order:
 *
 *  1. **the signed-in account** (`AuthUser.locale`) — the answer, once there is
 *     a session. It travels with the account, so the same reader gets the same
 *     language on their phone as on their laptop;
 *  2. **`localStorage`** — what the pre-auth screens use, and what makes a
 *     returning reader's first paint right rather than briefly English;
 *  3. **the browser's own preference**, for a first visit.
 *
 * The account wins over the stored value on purpose. They can only disagree if
 * the reader changed the language in another browser, and the account is the one
 * that followed them there.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const locale = user?.locale ?? storedLocale();

  // **During render, not in an effect.** Every pure formatter in the app reads
  // the module variable rather than this context (see `lib/locale`), and an
  // effect runs *after* the children have rendered — so the first paint after a
  // language change would format its dates in the previous language, and a
  // reader switching language would watch half the screen change and the other
  // half follow a frame later. Assigning here is idempotent and touches nothing
  // React owns, so it is safe in a render pass in a way that setState would not
  // be.
  if (activeLocale() !== locale) setActiveLocale(locale);

  // The API answers in the reader's language, and on the pre-auth screens the
  // header is the only way it can know which that is — there is no account to
  // read yet on sign-in, register, verify or invite-join. Sent as the language
  // being *displayed*, not the browser's preference: those differ for anyone who
  // has chosen a language here, and an error belongs in the language of the screen
  // it appears on. Set during render for the same reason as above — a request
  // fired from a child's first effect must already carry it.
  setApiLanguage(intlTagFor(locale));

  // Remembering it *is* a side effect, so it belongs in one. Only ever mirrors
  // the signed-in account's choice: writing the browser's own guess here would
  // turn a first visit into a stored preference the reader never expressed, and
  // then that guess would outlive their account's real answer.
  useEffect(() => {
    if (user?.locale) rememberLocale(user.locale);
  }, [user?.locale]);

  return (
    <LocaleContext.Provider value={{ locale, intlTag: intlTagFor(locale) }}>
      {children}
    </LocaleContext.Provider>
  );
}
