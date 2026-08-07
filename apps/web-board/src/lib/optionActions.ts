import { useState } from "react";
import type { OptionView } from "@gtp/types";
import { ApiError, useUnlockOption } from "@gtp/api-client";

/**
 * Unlocking a locked option, with the failure it can produce.
 *
 * Shared because a decision is reachable from two places — the full card (in a
 * lane, or wherever a locked card is rendered) and the compact chip in the
 * Decided rail — and "undo this decision" must behave identically in both. It
 * returns the error rather than showing it, since the two surfaces have very
 * different room to put one.
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
        setError(err instanceof ApiError ? err.message : "Could not unlock");
      }
    },
  };
}
