import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  PLACE_QUERY_MIN_LENGTH,
  type PlaceSearchResult,
  type PlaceView,
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
 * How a place reads on one line: "Lisbon, Lisboa, Portugal".
 *
 * Here rather than in the board app because it is also what gets written into
 * the trip's `destination` field when a suggestion is chosen — the string the
 * board displays and the string the picker showed have to be the same one, or
 * choosing a suggestion silently changes what you picked.
 *
 * The region is dropped when it repeats the name, which happens constantly:
 * Lisbon sits in Lisboa, Vienna in Vienna, and "Vienna, Vienna, Austria" reads
 * as a bug rather than as precision.
 */
export function placeLabel(place: PlaceView): string {
  const parts = [place.name];
  if (place.region && !sameWord(place.region, place.name)) {
    parts.push(place.region);
  }
  if (!sameWord(place.countryName, place.name)) parts.push(place.countryName);
  return parts.join(", ");
}

/** Case-folded equality, and nothing looser. "Lisboa" and "Lisbon" are different
 *  names to a reader and both are worth printing; only a literal repeat is
 *  noise. */
function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
