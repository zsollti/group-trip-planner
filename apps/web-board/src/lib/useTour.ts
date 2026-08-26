import { createContext, useContext } from "react";
import type { TourKind, TourStep } from "./tour";

/**
 * The guided tour's controls, as the tree sees them.
 *
 * Split from `components/Tour` for the same mechanical reason `useLocale` is
 * split from its provider: a module exporting both a component and a hook
 * defeats fast refresh, so the provider file exports only components.
 */
export interface TourApi {
  /**
   * Offer the tour for the current route. Called by `TourSteps`.
   *
   * The kind rides along with the steps because the two are one fact: which
   * tour this is decides how it signs off and which of the account's two marks
   * its exit sets, and a route that offered steps without saying which tour
   * they belong to would leave the overlay guessing.
   */
  readonly offer: (steps: readonly TourStep[], kind: TourKind) => void;
  /** Run it now — the account menu's "Show me around". */
  readonly start: () => void;
  /** Whether this route has anything to point at. Keeps the menu item honest. */
  readonly available: boolean;
}

export const TourContext = createContext<TourApi | null>(null);

/**
 * The tour controls.
 *
 * Falls back to a dead API outside a provider rather than throwing, unlike
 * {@link useLocale}. The difference is what happens when it is missing: a
 * component with no language renders the wrong words and must not be allowed
 * to, while a component with no tour renders one menu item fewer. Every test
 * that mounts a `UserMenu` would otherwise have to mount a provider to check
 * something unrelated to tours.
 */
export function useTour(): TourApi {
  return (
    useContext(TourContext) ?? {
      offer: () => undefined,
      start: () => undefined,
      available: false,
    }
  );
}
