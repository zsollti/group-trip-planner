import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AdminAuditLog,
  AdminDemoSeed,
  AdminPlacesSeed,
  AdminOverview,
  AdminUserLookup,
  AdminUserSummary,
  BanUserInput,
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
      apiFetch<AdminUserLookup>(`/admin/users?q=${encodeURIComponent(query)}`),
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

/**
 * Suspend an account, with terms.
 *
 * The one action here that takes a body, which is why it is not built from
 * {@link useAdminUserAction} above: the terms *are* the feature. A ban with no
 * reason and no end is the thing this console should make hard to do by
 * accident, so the shape of the call insists on both being decided.
 */
export function useBanUser(): UseMutationResult<
  AdminUserSummary,
  ApiError,
  { userId: string; input: BanUserInput }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, input }) =>
      apiFetch<AdminUserSummary>(`/admin/users/${userId}/ban`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

/** Lift a suspension. */
export function useUnbanUser(): UseMutationResult<
  AdminUserSummary,
  ApiError,
  string
> {
  return useAdminUserAction("unban");
}

/**
 * Rebuild the public demo trip.
 *
 * Takes no argument — the seed's scope is fixed server-side, and a parameter
 * here would imply this could be pointed somewhere else.
 *
 * Invalidates the whole console: the rebuild writes an audit row, and it moves
 * the volume counts the overview panel is showing (a demo trip is five accounts
 * and fourteen options). Leaving those stale after an action that changed them
 * is how an operator ends up wondering whether the button did anything.
 */
export function useRunDemoSeed(): UseMutationResult<
  AdminDemoSeed,
  ApiError,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<AdminDemoSeed>("/admin/demo-seed", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}

/**
 * Load the place gazetteer into this environment.
 *
 * The console's slowest action by a distance — tens of thousands of rows in
 * chunked inserts — so the caller is expected to show it working rather than
 * assume it is instant.
 *
 * Invalidates the console like the demo seed does: it writes an audit row, and
 * an operator who cannot see that the thing they pressed was recorded will press
 * it again.
 */
export function useRunPlacesSeed(): UseMutationResult<
  AdminPlacesSeed,
  ApiError,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<AdminPlacesSeed>("/admin/places-seed", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all });
    },
  });
}
