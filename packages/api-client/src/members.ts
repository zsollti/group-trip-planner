import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  AssignableRole,
  TripDetail,
  TripMembersView,
  TripMemberView,
  TripMuteView,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { tripKeys } from "./trips.js";
import { dashboardKeys } from "./dashboard.js";
import { optionKeys } from "./options.js";

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
 * trip's detail (the caller's own role / member count), the trip list, the
 * cost dashboard (a join/leave/kick changes the member count, which re-prices
 * dynamic headcounts and flips fixed-headcount stale flags — Phase 3.2), and
 * **the lanes**.
 *
 * The lanes, because a removal takes the person's votes and opt-ins with it
 * (see the members service): their face was on the voter stack of every card
 * they had voted for, and without this the board went on showing it — and
 * counting it — until somebody reloaded the page. Which is what a reader
 * reports as "I removed them and their votes stayed". */
function invalidateMembership(
  qc: ReturnType<typeof useQueryClient>,
  tripId: string,
) {
  void qc.invalidateQueries({ queryKey: memberKeys.list(tripId) });
  void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
  void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
  void qc.invalidateQueries({ queryKey: optionKeys.lists(tripId) });
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
      // The trip drops off the caller's home dashboard.
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * Mute or unmute this trip's notification **email** for the caller (Phase 5.3).
 *
 * The trip detail carries `viewerMuted`, so the server's answer is patched
 * straight into that cached object rather than invalidating it — the control
 * settles without a refetch, and without a window where the toggle shows the
 * old value.
 */
export function useSetTripMute(
  tripId: string,
): UseMutationResult<TripMuteView, ApiError, boolean> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) =>
      apiFetch<TripMuteView>(`/trips/${tripId}/members/mute`, {
        method: "POST",
        body: { muted },
      }),
    onSuccess: (result) => {
      qc.setQueryData<TripDetail>(tripKeys.detail(tripId), (current) =>
        current ? { ...current, viewerMuted: result.muted } : current,
      );
    },
  });
}
