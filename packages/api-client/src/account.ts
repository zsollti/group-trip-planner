import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AccountDeletionImpact,
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/**
 * Account self-management hooks (Phase 1.5, SRS FR-6; preferences in 5.3). The
 * *deletion* action itself lives on the AuthProvider (`useAuth().deleteAccount`)
 * because it tears down the session like logout; this module owns the read-only
 * impact preview that drives the warning prompt, plus the notification
 * preferences the settings screen edits.
 */

export const accountKeys = {
  deletionPreview: ["account", "deletion-preview"] as const,
  preferences: ["account", "preferences"] as const,
};

/**
 * Preview what deleting the current account will do — which owned trips transfer
 * (and to whom) and which solo trips are deleted. Fetched fresh when the delete
 * flow opens (not cached long) so the warning reflects the latest membership.
 */
export function useDeletionPreview(
  enabled = true,
): UseQueryResult<AccountDeletionImpact, ApiError> {
  return useQuery({
    queryKey: accountKeys.deletionPreview,
    queryFn: () => apiFetch<AccountDeletionImpact>("/account/deletion-preview"),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/** The caller's notification preferences (Phase 5.3). */
export function useNotificationPreferences(): UseQueryResult<
  NotificationPreferences,
  ApiError
> {
  return useQuery({
    queryKey: accountKeys.preferences,
    queryFn: () => apiFetch<NotificationPreferences>("/account/preferences"),
  });
}

/**
 * Update the caller's notification preferences. The server's stored result is
 * written straight into the cache, so a toggle that the server rejected or
 * clamped snaps back to the truth instead of lying in the UI.
 */
export function useUpdateNotificationPreferences(): UseMutationResult<
  NotificationPreferences,
  ApiError,
  UpdateNotificationPreferencesInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      apiFetch<NotificationPreferences>("/account/preferences", {
        method: "PATCH",
        body: input,
      }),
    onSuccess: (prefs) => {
      queryClient.setQueryData(accountKeys.preferences, prefs);
    },
  });
}
