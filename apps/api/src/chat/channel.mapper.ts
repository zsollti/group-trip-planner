import type { Channel } from "@prisma/client";
import type { ChannelView } from "@gtp/types";

/** Prisma Channel row → the shared client-facing {@link ChannelView}. */
export function toChannelView(channel: Channel): ChannelView {
  return {
    id: channel.id,
    tripId: channel.tripId,
    categoryId: channel.categoryId,
    type: channel.type,
  };
}
