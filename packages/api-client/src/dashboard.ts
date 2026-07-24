import { useQuery, type UseQueryResult } from "@tanstack/react-query";
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
