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
  UpdateTripInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { dashboardKeys } from "./dashboard.js";

/** Query-key factory for trip data, so invalidation stays consistent. */
export const tripKeys = {
  all: ["trips"] as const,
  detail: (id: string) => [...tripKeys.all, "detail", id] as const,
  preview: (id: string) => [...tripKeys.all, "preview", id] as const,
};

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

/** Create a trip; on success the caller's home dashboard is invalidated. */
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
      // The home dashboard's own list/summaries key (Phase 3.4) must refresh.
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.setQueryData(tripKeys.detail(trip.id), trip);
    },
  });
}

/**
 * Edit a trip's details (Owner/Co-organizer). The caller passes the `version`
 * they last saw; a 409 {@link ApiError} means it changed underneath them and
 * the UI should prompt a reload. On success the cached detail + dashboard
 * refresh.
 */
export function useUpdateTrip(
  id: string,
): UseMutationResult<TripDetail, ApiError, UpdateTripInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTripInput) =>
      apiFetch<TripDetail>(`/trips/${id}`, { method: "PATCH", body: input }),
    onSuccess: (trip) => {
      qc.setQueryData(tripKeys.detail(id), trip);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * Set or replace a trip's cover image (Phase 6.2, organizers). Sends the file
 * itself, not a URL: the server runs it through the hardened pipeline, so the
 * cover can only ever be an image this service stored. The updated trip is
 * written straight into the cache.
 */
export function useSetTripCover(
  id: string,
): UseMutationResult<TripDetail, ApiError, File> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<TripDetail>(`/trips/${id}/cover`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (trip) => {
      qc.setQueryData(tripKeys.detail(id), trip);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/** Remove a trip's cover; the stored image goes with it. */
export function useRemoveTripCover(
  id: string,
): UseMutationResult<TripDetail, ApiError, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<TripDetail>(`/trips/${id}/cover`, { method: "DELETE" }),
    onSuccess: (trip) => {
      qc.setQueryData(tripKeys.detail(id), trip);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * Set or replace the picture the board's chat wears (post-launch, organizers).
 *
 * The cover's shape exactly, down to sending the file rather than a URL — see
 * {@link useSetTripCover}. The dashboard is invalidated as well as the detail
 * written, because the chat dock draws its list of boards from the dashboard's
 * summaries and this picture is what those rows show.
 */
export function useSetChatImage(
  id: string,
): UseMutationResult<TripDetail, ApiError, File> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<TripDetail>(`/trips/${id}/chat-image`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (trip) => {
      qc.setQueryData(tripKeys.detail(id), trip);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/** Remove the chat picture; the stored image goes with it. */
export function useRemoveChatImage(
  id: string,
): UseMutationResult<TripDetail, ApiError, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<TripDetail>(`/trips/${id}/chat-image`, { method: "DELETE" }),
    onSuccess: (trip) => {
      qc.setQueryData(tripKeys.detail(id), trip);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/** Delete a trip (Owner only). Clears its cached detail, refreshes the dashboard. */
export function useDeleteTrip(
  id: string,
): UseMutationResult<void, ApiError, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/trips/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: tripKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
