import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { HomeDashboardView, TripDashboardView } from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for the cost dashboards (per-trip + all-trips home). */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  trip: (tripId: string) => [...dashboardKeys.all, "trip", tripId] as const,
  home: (limit: number, offset: number) =>
    [...dashboardKeys.all, "home", limit, offset] as const,
};

/**
 * A trip's per-currency cost dashboard (any member). The figures are computed
 * server-side by the pure cost engine; the three front-ends render this same
 * object in their own paradigm. Invalidated by the option/vote/lock mutations
 * (which change the totals) and by membership changes (which flip stale flags) —
 * consumers should invalidate {@link dashboardKeys.trip} alongside those.
 */
export function useTripDashboard(
  tripId: string | undefined,
): UseQueryResult<TripDashboardView, ApiError> {
  return useQuery({
    queryKey: dashboardKeys.trip(tripId ?? ""),
    queryFn: () => apiFetch<TripDashboardView>(`/trips/${tripId!}/dashboard`),
    enabled: Boolean(tripId),
  });
}

/**
 * The all-trips home dashboard (Phase 3.4): the caller's trips with a per-currency
 * committed cost summary and a pending-decision count, one offset-paginated page.
 * The three home surfaces split `trips` into Active/History by each trip's status.
 */
export function useHomeDashboard(
  limit = 20,
  offset = 0,
): UseQueryResult<HomeDashboardView, ApiError> {
  return useQuery({
    queryKey: dashboardKeys.home(limit, offset),
    queryFn: () =>
      apiFetch<HomeDashboardView>(`/dashboard?limit=${limit}&offset=${offset}`),
  });
}

/**
 * Save the caller's own arrangement of their overview.
 *
 * **Writes the new order into the cache first and does not invalidate on
 * success.** A drag is one of the few mutations where the client is the
 * authority on the result: the tile is already under the pointer where the user
 * put it, and refetching would replay the same order a beat later — or worse,
 * animate the tile back and forth if the request is slow. The rollback on
 * failure is the honest part: if the write is refused, the tiles return to
 * where they were rather than showing an order the server does not have.
 */
export function useReorderTrips(
  limit = 20,
  offset = 0,
): UseMutationResult<
  void,
  ApiError,
  readonly string[],
  { previous?: HomeDashboardView }
> {
  const qc = useQueryClient();
  const key = dashboardKeys.home(limit, offset);
  return useMutation({
    mutationFn: (tripIds: readonly string[]) =>
      // The object, not a string of it: `apiFetch` serializes. Stringifying
      // here sent the server a JSON *string* where it wanted an object, so
      // every drag was answered 400 and rolled straight back — which is what a
      // tile that would not stay put actually was.
      apiFetch<void>("/dashboard/order", {
        method: "PATCH",
        body: { tripIds },
      }),
    onMutate: async (tripIds) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<HomeDashboardView>(key);
      if (previous) {
        const byId = new Map(previous.trips.map((t) => [t.id, t]));
        qc.setQueryData<HomeDashboardView>(key, {
          ...previous,
          trips: tripIds
            .map((id) => byId.get(id))
            .filter((t): t is HomeDashboardView["trips"][number] => Boolean(t)),
        });
      }
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
  });
}
