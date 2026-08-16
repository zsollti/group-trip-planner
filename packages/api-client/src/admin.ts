import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AdminAuditLog,
  AdminOverview,
  AdminUserLookup,
  AdminUserSummary,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for the operator console. */
export const adminKeys = {
  all: ["admin"] as const,
  overview: () => [...adminKeys.all, "overview"] as const,
  users: (q: string) => [...adminKeys.all, "users", q] as const,
  audit: () => [...adminKeys.all, "audit"] as const,
};

/**
 * The console's landing view.
 *
 * `staleTime: 0` overrides the app-wide 30 seconds, because this is the one
 * screen whose entire purpose is to be current — an operator refreshing it
 * while watching a deploy is asking a live question, and a cached answer to
 * "is the queue stuck" is worse than no answer.
 */
export function useAdminOverview(): UseQueryResult<AdminOverview, ApiError> {
  return useQuery({
    queryKey: adminKeys.overview(),
    queryFn: () => apiFetch<AdminOverview>("/admin/overview"),
    staleTime: 0,
  });
}

/** Find people by email fragment, name, or exact id. Idle until asked. */
export function useAdminUserLookup(
  query: string,
): UseQueryResult<AdminUserLookup, ApiError> {
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () =>
      apiFetch<AdminUserLookup>(
        `/admin/users?q=${encodeURIComponent(query)}`,
      ),
    enabled: query.trim().length > 0,
    staleTime: 0,
  });
}

/** What operators have done here, newest first. */
export function useAdminAudit(): UseQueryResult<AdminAuditLog, ApiError> {
  return useQuery({
    queryKey: adminKeys.audit(),
    queryFn: () => apiFetch<AdminAuditLog>("/admin/audit"),
    staleTime: 0,
  });
}

/**
 * The console's two actions, which are the same shape: POST against a user,
 * answered with that user re-read.
 *
 * Both invalidate the audit log as well as the lookup, because both write to
 * it — an action whose record does not appear until a manual refresh invites
 * the operator to wonder whether it was written at all.
 */
function useAdminUserAction(
  path: string,
): UseMutationResult<AdminUserSummary, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<AdminUserSummary>(`/admin/users/${userId}/${path}`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

/** Issue and send a fresh verification link. */
export function useResendVerification(): UseMutationResult<
  AdminUserSummary,
  ApiError,
  string
> {
  return useAdminUserAction("resend-verification");
}

/** Mark an account verified without the email round trip. */
export function useMarkVerified(): UseMutationResult<
  AdminUserSummary,
  ApiError,
  string
> {
  return useAdminUserAction("verify");
}
