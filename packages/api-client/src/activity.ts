import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import type { ActivityPage } from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for a trip's activity feed. */
export const activityKeys = {
  all: ["activity"] as const,
  list: (tripId: string) => [...activityKeys.all, "list", tripId] as const,
};

/**
 * The trip activity feed (Phase 5.4), cursor-paged.
 *
 * An infinite query rather than a plain one: the feed is read newest-first and
 * walked backwards ("what did I miss?"), so pages accumulate as the reader
 * scrolls instead of replacing each other.
 *
 * `enabled` is off while the panel is closed, so opening it fetches fresh
 * history rather than showing a cached page from an earlier visit.
 */
export function useTripActivity(
  tripId: string | undefined,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<ActivityPage>, ApiError> {
  return useInfiniteQuery({
    queryKey: activityKeys.list(tripId ?? ""),
    queryFn: ({ pageParam }) =>
      apiFetch<ActivityPage>(
        `/trips/${tripId}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(tripId) && enabled,
    staleTime: 0,
  });
}
