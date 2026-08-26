import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  MESSAGE_SEARCH_MIN_LENGTH,
  type ChatMuteInput,
  type ChatMuteView,
  type MessageSearchView,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/** Query-key factory for searching a board's transcript. */
export const messageSearchKeys = {
  all: ["message-search"] as const,
  trip: (tripId: string) => [...messageSearchKeys.all, tripId] as const,
  search: (tripId: string, q: string) =>
    [...messageSearchKeys.trip(tripId), q] as const,
};

/**
 * Every message on this board whose text contains `query`.
 *
 * Keyed by trip *and* term, because the answer is only meaningful for the board
 * it was asked of: a reader with two boards open would otherwise see one
 * board's hits under the other's search box.
 *
 * **A short staleness window rather than none, and rather than `Infinity`.**
 * The gazetteer behind {@link usePlaceSearch} is a snapshot that changes once a
 * year, so caching its answers forever is merely honest. A transcript is the
 * opposite: it grows while the reader is reading it. But a search is a *find* —
 * the reader types, looks down the hits, clicks one, comes back — and refetching
 * on every one of those returns would make the list flicker for no new
 * information. Fifteen seconds is long enough to cover that loop and short
 * enough that a search re-run later is genuinely re-run.
 *
 * The debounce is not here, for the same reason it is not in the places hook:
 * what wants delaying is the keystroke becoming a request at all.
 *
 * Disabled below {@link MESSAGE_SEARCH_MIN_LENGTH}, the floor the server
 * applies too — one character matches most of a transcript, which is not an
 * answer to anything.
 */
export function useMessageSearch(
  tripId: string,
  query: string,
  enabled = true,
): UseQueryResult<MessageSearchView, ApiError> {
  const q = query.trim();
  return useQuery({
    queryKey: messageSearchKeys.search(tripId, q),
    queryFn: () =>
      apiFetch<MessageSearchView>(
        `/trips/${tripId}/messages/search?q=${encodeURIComponent(q)}`,
      ),
    enabled: enabled && q.length >= MESSAGE_SEARCH_MIN_LENGTH,
    staleTime: 15_000,
    // Keep the previous hits on screen while the next request is in flight, so
    // the list does not blink empty between letters.
    placeholderData: (prev) => prev,
  });
}

/**
 * Silence this board's chat for the reader, or let it speak again.
 *
 * **No cache to invalidate.** The mute the app actually draws from lives in the
 * socket's ready payload, beside the unread counts it silences — so the caller
 * hands the answer to `setTripMute` and the badges go quiet on the same frame.
 * A query key here would be a second copy of the same fact, and the two would
 * disagree for exactly as long as it took a refetch to land.
 */
export function useSetChatMute(
  tripId: string,
): UseMutationResult<ChatMuteView, ApiError, ChatMuteInput> {
  return useMutation({
    mutationFn: (input: ChatMuteInput) =>
      apiFetch<ChatMuteView>(`/trips/${tripId}/chat-mute`, {
        method: "PUT",
        body: input,
      }),
  });
}
