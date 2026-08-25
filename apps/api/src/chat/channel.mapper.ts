import type { Channel } from "@prisma/client";
import type { ChannelView } from "@gtp/types";

/**
 * Prisma Channel row → the shared client-facing {@link ChannelView}.
 *
 * `lastMessageAt` is passed in rather than read off the row: it is an aggregate
 * over the channel's messages, not a column, and the one caller that needs it
 * for a whole trip computes it for every channel in a single query. A caller
 * with nothing to say (a channel just created, so demonstrably empty) omits it.
 */
export function toChannelView(
  channel: Channel,
  lastMessageAt: Date | null = null,
): ChannelView {
  return {
    id: channel.id,
    tripId: channel.tripId,
    categoryId: channel.categoryId,
    type: channel.type,
    lastMessageAt: lastMessageAt?.toISOString() ?? null,
  };
}
