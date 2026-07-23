import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AssignableRole,
  TripMembersView,
  TripMemberView,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { tripKeys } from "./trips.js";

/** Query-key factory for a trip's member/block list. */
export const memberKeys = {
  all: ["members"] as const,
  list: (tripId: string) => [...memberKeys.all, "list", tripId] as const,
};

/** The trip's members + block list (Owner/Co-organizer drive the controls). */
export function useTripMembers(
  tripId: string | undefined,
  enabled = true,
): UseQueryResult<TripMembersView, ApiError> {
  return useQuery({
    queryKey: memberKeys.list(tripId ?? ""),
    queryFn: () => apiFetch<TripMembersView>(`/trips/${tripId}/members`),
    enabled: Boolean(tripId) && enabled,
  });
}

/** Invalidate everything a membership change can touch: the member list, the
 * trip's detail (the caller's own role / member count), and the trip list. */
function invalidateMembership(
  qc: ReturnType<typeof useQueryClient>,
  tripId: string,
) {
  void qc.invalidateQueries({ queryKey: memberKeys.list(tripId) });
  void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
  void qc.invalidateQueries({ queryKey: tripKeys.list() });
}

/** Change a member's role. */
export function useChangeMemberRole(
  tripId: string,
): UseMutationResult<
  TripMemberView,
  ApiError,
  { userId: string; role: AssignableRole }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }) =>
      apiFetch<TripMemberView>(`/trips/${tripId}/members/${userId}`, {
        method: "PATCH",
        body: { role },
      }),
    onSuccess: () => invalidateMembership(qc, tripId),
  });
}

/** Kick a member (soft removal). */
export function useKickMember(
  tripId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/trips/${tripId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateMembership(qc, tripId),
  });
}

/** Block a member (ejection + hard bar). */
export function useBlockMember(
  tripId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/trips/${tripId}/members/${userId}/block`, {
        method: "POST",
      }),
    onSuccess: () => invalidateMembership(qc, tripId),
  });
}

/** Unblock a user (removes the bar). */
export function useUnblockMember(
  tripId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/trips/${tripId}/members/${userId}/block`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateMembership(qc, tripId),
  });
}

/** Transfer ownership to another member (Owner only). */
export function useTransferOwnership(
  tripId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/trips/${tripId}/members/transfer`, {
        method: "POST",
        body: { userId },
      }),
    onSuccess: () => invalidateMembership(qc, tripId),
  });
}

/** Leave a trip (Owner must transfer/delete first — the API 403s otherwise). */
export function useLeaveTrip(
  tripId: string,
): UseMutationResult<void, ApiError, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/trips/${tripId}/members/leave`, { method: "POST" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: tripKeys.detail(tripId) });
      void qc.invalidateQueries({ queryKey: tripKeys.list() });
    },
  });
}
