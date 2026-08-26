import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type {
  ChannelView,
  DeleteChannelsInput,
  StartDiscussionInput,
} from "@gtp/types";
import { apiFetch, type ApiError } from "./http.js";

/**
 * Start (or reopen) a category's discussion channel (Phase 4.5, FR-29). POSTs the
 * category id; the server creates its `CATEGORY` channel on demand, idempotently,
 * and returns the {@link ChannelView} (existing or new). The channel list itself
 * is owned by the trip socket's ready payload + the live `channel:created`
 * broadcast, not a query — so this mutation just returns the channel to open; it
 * has no cache to invalidate. Any member may start a discussion.
 */
export function useStartDiscussion(
  tripId: string,
): UseMutationResult<ChannelView, ApiError, StartDiscussionInput> {
  return useMutation({
    mutationFn: (input: StartDiscussionInput) =>
      apiFetch<ChannelView>(`/trips/${tripId}/channels`, {
        method: "POST",
        body: input,
      }),
  });
}

/**
 * Delete discussions from a board (post-launch, organizers).
 *
 * No cache to invalidate, for the same reason {@link useStartDiscussion} has
 * none: the channel list belongs to the trip socket, not to a query. The
 * server's `channels:deleted` broadcast is what removes them — from every
 * reader on the board, not just the organizer who pressed the button, which a
 * local cache update could never manage.
 *
 * Returns the ids actually deleted. An id that was already gone comes back
 * absent rather than as an error: two organizers tidying the same board at once
 * both wanted the same end state, and they got it.
 */
export function useDeleteChannels(
  tripId: string,
): UseMutationResult<string[], ApiError, DeleteChannelsInput> {
  return useMutation({
    mutationFn: (input: DeleteChannelsInput) =>
      apiFetch<string[]>(`/trips/${tripId}/channels/delete`, {
        method: "POST",
        body: input,
      }),
  });
}
