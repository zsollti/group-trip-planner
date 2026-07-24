import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { TripDashboardView } from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for a trip's cost dashboard. */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  trip: (tripId: string) => [...dashboardKeys.all, "trip", tripId] as const,
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
