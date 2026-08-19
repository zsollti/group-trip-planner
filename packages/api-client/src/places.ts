import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  PLACE_QUERY_MIN_LENGTH,
  placeLabel,
  type PlaceSearchResult,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for the destination type-ahead. */
export const placeKeys = {
  all: ["places"] as const,
  search: (q: string) => [...placeKeys.all, "search", q] as const,
};

/**
 * Suggestions for a destination as it is being typed.
 *
 * **Cached per query string, and never garbage-collected in a hurry.** A person
 * filling this in types forwards and backwards — "lisb", "lisbo", "lisb" again
 * after a correction — and every one of those is a key that was answered a
 * moment ago. `staleTime: Infinity` is honest here in a way it rarely is: a
 * gazetteer is a seeded snapshot that changes once a year, so an answer from
 * thirty seconds ago is not merely acceptable, it is identical.
 *
 * The debounce is **not** here. It belongs to the field, because what wants
 * delaying is the keystroke becoming a query at all — a hook that debounced
 * internally would still re-render on every letter and would hold a stale key
 * while it waited.
 *
 * Disabled below {@link PLACE_QUERY_MIN_LENGTH}, which is the same floor the
 * server applies: one letter matches thousands of places and ranks them by
 * population, which is a list of capitals rather than an answer.
 */
export function usePlaceSearch(
  query: string,
  enabled = true,
): UseQueryResult<PlaceSearchResult, ApiError> {
  const q = query.trim();
  return useQuery({
    queryKey: placeKeys.search(q),
    queryFn: () =>
      apiFetch<PlaceSearchResult>(`/places?q=${encodeURIComponent(q)}`),
    enabled: enabled && q.length >= PLACE_QUERY_MIN_LENGTH,
    staleTime: Infinity,
    // Keep the previous answer on screen while the next one is in flight, so the
    // list does not blink empty between letters.
    placeholderData: (prev) => prev,
  });
}

/**
 * Re-exported, not defined here.
 *
 * It moved to `@gtp/types` when the demo seed needed the same rule — a seed
 * cannot import a package built on React Query — and it stays exported from this
 * module so nothing that already imported it from here had to change.
 */
export { placeLabel };
