import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreatePersonalItemInput,
  PersonalItemView,
  ReorderPersonalItemsInput,
  UpdatePersonalItemInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";
import { dashboardKeys } from "./dashboard.js";

/**
 * Query-key factory for one member's private list on one trip.
 *
 * **The viewer id is part of the key, and that is not decoration.** Signing out
 * clears the session but deliberately leaves the React Query cache alone, so on
 * a shared browser the next person to sign in starts against the previous
 * person's cached data. For options that is harmless — the cached rows are the
 * same rows anybody on that trip would be served, and a refetch corrects the
 * staleness. These rows are not: without the viewer in the key, person B would
 * be handed person A's private list to render for as long as it took the first
 * fetch to land, from a cache the server never gets asked about.
 *
 * Keying on the viewer makes that impossible rather than brief. B's key has
 * never been fetched, so there is nothing to serve from and the list renders
 * empty until B's own answer arrives.
 */
export const personalItemKeys = {
  all: ["personal-items"] as const,
  list: (tripId: string, viewerId: string) =>
    [...personalItemKeys.all, "list", tripId, viewerId] as const,
};

function itemsPath(tripId: string): string {
  return `/trips/${tripId}/personal-items`;
}

/**
 * Why the viewer is a **parameter** here and not read from the session.
 *
 * Reading it from `useAuth` was the first shape, and it made every one of these
 * hooks unusable outside an `<AuthProvider>` — which is how the board's own
 * tests render the canvas. More to the point, it would have been the only
 * identity in this app fetched that way: the board resolves the signed-in user
 * once at the top and threads `myUserId` down through the lanes and the cards,
 * so a second, hidden source of the same fact is a second thing that can
 * disagree.
 *
 * It is safe to pass because **it is a cache key and nothing else**. The server
 * answers every one of these routes for the caller its access token names,
 * whatever this argument says, so a wrong value cannot fetch another person's
 * rows — it can only fail to find its own.
 */

/** Replace the whole cached list, which is the only granularity that applies. */
function setList(
  qc: QueryClient,
  tripId: string,
  viewerId: string,
  next: (items: PersonalItemView[]) => PersonalItemView[],
): void {
  qc.setQueryData<PersonalItemView[]>(
    personalItemKeys.list(tripId, viewerId),
    (prev) => (prev ? next(prev) : prev),
  );
}

/** The caller's own items on this trip, in their own order. */
export function usePersonalItems(
  tripId: string | undefined,
  viewerId: string | undefined,
): UseQueryResult<PersonalItemView[], ApiError> {
  return useQuery({
    queryKey: personalItemKeys.list(tripId ?? "", viewerId ?? ""),
    queryFn: () => apiFetch<PersonalItemView[]>(itemsPath(tripId!)),
    enabled: Boolean(tripId) && Boolean(viewerId),
  });
}

/**
 * Add an item. The response is appended straight to the cached list — the
 * server appends at `max(position) + 1` and the list is ordered by position, so
 * the end of the array is exactly where it belongs.
 *
 * The dashboard is invalidated because the cost surface counts these into the
 * viewer's own total. It is the only shared consequence a personal write has,
 * and even that one is shared with nobody: the dashboard read is per-viewer.
 */
export function useCreatePersonalItem(
  tripId: string,
  viewerId: string,
): UseMutationResult<PersonalItemView, ApiError, CreatePersonalItemInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePersonalItemInput) =>
      apiFetch<PersonalItemView>(itemsPath(tripId), {
        method: "POST",
        body: input,
      }),
    onSuccess: (created) => {
      setList(qc, tripId, viewerId, (items) => [...items, created]);
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/** Edit one of the caller's own items — a full replace, like an option edit. */
export function useUpdatePersonalItem(
  tripId: string,
  viewerId: string,
): UseMutationResult<
  PersonalItemView,
  ApiError,
  { itemId: string } & UpdatePersonalItemInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...body }) =>
      apiFetch<PersonalItemView>(`${itemsPath(tripId)}/${itemId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (updated) => {
      setList(qc, tripId, viewerId, (items) =>
        items.map((i) => (i.id === updated.id ? updated : i)),
      );
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/** Delete one of the caller's own items. Answers with nothing, so the list is
 * patched from the id we sent. */
export function useDeletePersonalItem(
  tripId: string,
  viewerId: string,
): UseMutationResult<void, ApiError, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<void>(`${itemsPath(tripId)}/${itemId}`, { method: "DELETE" }),
    onSuccess: (_void, itemId) => {
      setList(qc, tripId, viewerId, (items) =>
        items.filter((i) => i.id !== itemId),
      );
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });
    },
  });
}

/**
 * Reorder the caller's own column. The server answers with the whole list in
 * its new order, so the cache takes that answer rather than recomputing it.
 *
 * No dashboard invalidation: order is not money.
 */
export function useReorderPersonalItems(
  tripId: string,
  viewerId: string,
): UseMutationResult<PersonalItemView[], ApiError, ReorderPersonalItemsInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReorderPersonalItemsInput) =>
      apiFetch<PersonalItemView[]>(`${itemsPath(tripId)}/reorder`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (ordered) => {
      qc.setQueryData(personalItemKeys.list(tripId, viewerId), ordered);
    },
  });
}
