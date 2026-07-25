import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ChannelUnread, ChannelView, ChatReadyPayload } from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { toChannelView } from "./channel.mapper.js";

/**
 * Channels domain service (Phase 4.1). Owns the trip's chat channels: the
 * auto-created General channel (written inside trip creation) and, from Phase
 * 4.5, on-demand per-category channels. The read side (`listForTrip`) backs the
 * socket's ready payload.
 */
@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a trip's General channel **inside the trip-creation transaction** so a
   * trip never exists without it (Phase 4.1 DoD). Static — it takes the
   * transaction client, mirroring {@link CategoriesService.seedBuiltins}.
   */
  static createGeneral(
    tx: Prisma.TransactionClient,
    tripId: string,
  ): Promise<{ id: string }> {
    return tx.channel.create({
      data: { tripId, type: "GENERAL" },
      select: { id: true },
    });
  }

  /** The channels a member of this trip can see, oldest first (General leads). */
  async listForTrip(tripId: string): Promise<ChannelView[]> {
    const channels = await this.prisma.channel.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    return channels.map(toChannelView);
  }

  /**
   * The ready payload for a connecting member (Phase 4.4): the channels plus
   * their per-channel unread counts. Unread = non-deleted messages after the
   * member's read cursor (`ChannelRead.lastReadAt`) authored by **someone else**
   * — you're never unread on your own messages, and a never-read channel counts
   * everything.
   */
  async readyPayload(
    tripId: string,
    userId: string,
  ): Promise<ChatReadyPayload> {
    const channels = await this.prisma.channel.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    const reads = await this.prisma.channelRead.findMany({
      where: { userId, channelId: { in: channels.map((c) => c.id) } },
    });
    const lastReadAt = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));

    const unread: ChannelUnread[] = await Promise.all(
      channels.map(async (c) => {
        const since = lastReadAt.get(c.id);
        const count = await this.prisma.message.count({
          where: {
            channelId: c.id,
            deletedAt: null,
            authorId: { not: userId },
            ...(since ? { createdAt: { gt: since } } : {}),
          },
        });
        return { channelId: c.id, count };
      }),
    );

    return { channels: channels.map(toChannelView), unread };
  }

  /** Advance the member's read cursor for a channel to now (Phase 4.4). Verifies
   * the channel belongs to the trip so an id from elsewhere is a 404. */
  async markRead(
    tripId: string,
    userId: string,
    channelId: string,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.tripId !== tripId) {
      throw new NotFoundException("Channel not found");
    }
    await this.prisma.channelRead.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
  }
}
