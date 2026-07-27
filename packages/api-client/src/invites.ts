import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateInviteInput,
  InviteLinkView,
  JoinTripResult,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { tripKeys } from "./trips.js";
import { dashboardKeys } from "./dashboard.js";

/** Query-key factory for a trip's invite links. */
export const inviteKeys = {
  all: ["invites"] as const,
  list: (tripId: string) => [...inviteKeys.all, "list", tripId] as const,
};

/** A trip's invite links (Owner/Co-organizer only — the API 403s otherwise). */
export function useTripInvites(
  tripId: string | undefined,
  enabled = true,
): UseQueryResult<InviteLinkView[], ApiError> {
  return useQuery({
    queryKey: inviteKeys.list(tripId ?? ""),
    queryFn: () => apiFetch<InviteLinkView[]>(`/trips/${tripId}/invites`),
    enabled: Boolean(tripId) && enabled,
  });
}

/** Create an invite link; refreshes the trip's invite list on success. */
export function useCreateInvite(
  tripId: string,
): UseMutationResult<InviteLinkView, ApiError, CreateInviteInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      apiFetch<InviteLinkView>(`/trips/${tripId}/invites`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inviteKeys.list(tripId) });
    },
  });
}

/** Disable a link (soft). Refreshes the invite list on success. */
export function useDisableInvite(
  tripId: string,
): UseMutationResult<InviteLinkView, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<InviteLinkView>(`/trips/${tripId}/invites/${inviteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inviteKeys.list(tripId) });
    },
  });
}

/**
 * Redeem an invite token. On success the caller's trip list (and the joined
 * trip's detail) are invalidated so the newly-joined trip appears immediately.
 */
export function useJoinTrip(): UseMutationResult<
  JoinTripResult,
  ApiError,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<JoinTripResult>(`/join/${encodeURIComponent(token)}`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: tripKeys.detail(result.tripId) });
      // The trip appears on the caller's home dashboard, and a new member
      // changes the head count → re-price the trip's cost dashboard too.
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
