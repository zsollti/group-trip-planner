import { createContext, useContext } from "react";
import type { Locale } from "@gtp/types";

/**
 * The reader's language, as the tree sees it.
 *
 * Split from `components/LocaleProvider` for a mechanical reason rather than a
 * conceptual one: a module that exports both a component and a hook defeats
 * fast refresh, so the provider file exports only the provider.
 */
export interface LocaleContextValue {
  /** The language the app is being read in. */
  locale: Locale;
  /** Its BCP-47 tag, for `Intl` and `toLocaleDateString`. */
  intlTag: string;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * The language for a component that renders words or dates.
 *
 * Throws outside a provider rather than defaulting, because a silent default is
 * how half a tree ends up in the wrong language with nothing to show for it.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside a LocaleProvider");
  return ctx;
}
