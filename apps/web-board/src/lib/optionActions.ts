import { useState } from "react";
import type { OptionView } from "@gtp/types";
import { ApiError, useUnlockOption } from "@gtp/api-client";
import { t } from "./i18n";

/**
 * Unlocking a locked option, with the failure it can produce.
 *
 * It returns the error rather than showing it, so a caller can put the message
 * where it has room for one.
 *
 * It was extracted when a decision was reachable from two places — its card in
 * the lane and its chip in the Decided rail — and "undo this decision" had to
 * behave identically in both. The rail is gone and the card's "⋯" menu is now
 * the only way to unlock, so there is one caller again. Kept as it is: it holds
 * the version-carrying call and its error handling away from a component that
 * has plenty of both already.
 */
export function useUnlockAction(
  tripId: string,
  categoryId: string,
  option: OptionView,
): { run: () => Promise<void>; pending: boolean; error: string | null } {
  const unlock = useUnlockOption(tripId, categoryId);
  const [error, setError] = useState<string | null>(null);

  return {
    pending: unlock.isPending,
    error,
    run: async () => {
      setError(null);
      try {
        await unlock.mutateAsync({
          optionId: option.id,
          version: option.version,
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("Could not unlock"));
      }
    },
  };
}
