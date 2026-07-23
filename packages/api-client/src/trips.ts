import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateTripInput,
  TripDetail,
  TripPreview,
  TripSummary,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for trip data, so invalidation stays consistent. */
export const tripKeys = {
  all: ["trips"] as const,
  list: () => [...tripKeys.all, "list"] as const,
  detail: (id: string) => [...tripKeys.all, "detail", id] as const,
  preview: (id: string) => [...tripKeys.all, "preview", id] as const,
};

/** The caller's trips (any role), newest first. */
export function useMyTrips(): UseQueryResult<TripSummary[], ApiError> {
  return useQuery({
    queryKey: tripKeys.list(),
    queryFn: () => apiFetch<TripSummary[]>("/trips"),
  });
}

/** Full detail for a trip the caller is a member of. */
export function useTrip(
  id: string | undefined,
): UseQueryResult<TripDetail, ApiError> {
  return useQuery({
    queryKey: tripKeys.detail(id ?? ""),
    queryFn: () => apiFetch<TripDetail>(`/trips/${id}`),
    enabled: Boolean(id),
  });
}

/** Public Visitor-scope preview (no auth required). */
export function useTripPreview(
  id: string | undefined,
): UseQueryResult<TripPreview, ApiError> {
  return useQuery({
    queryKey: tripKeys.preview(id ?? ""),
    queryFn: () => apiFetch<TripPreview>(`/trips/${id}/preview`),
    enabled: Boolean(id),
  });
}

/** Create a trip; on success the caller's trip list is invalidated. */
export function useCreateTrip(): UseMutationResult<
  TripDetail,
  ApiError,
  CreateTripInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTripInput) =>
      apiFetch<TripDetail>("/trips", { method: "POST", body: input }),
    onSuccess: (trip) => {
      void qc.invalidateQueries({ queryKey: tripKeys.list() });
      qc.setQueryData(tripKeys.detail(trip.id), trip);
    },
  });
}
