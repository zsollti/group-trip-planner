import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AccountDeletionImpact } from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/**
 * Account self-management hooks (Phase 1.5, SRS FR-6). The *deletion* action
 * itself lives on the AuthProvider (`useAuth().deleteAccount`) because it tears
 * down the session like logout; this module owns the read-only impact preview
 * that drives the warning prompt.
 */

export const accountKeys = {
  deletionPreview: ["account", "deletion-preview"] as const,
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
    queryFn: () =>
      apiFetch<AccountDeletionImpact>("/account/deletion-preview"),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}
