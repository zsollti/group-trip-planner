import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type { ChannelView, StartDiscussionInput } from "@gtp/types";
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
