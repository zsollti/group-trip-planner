import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ChannelView } from "@gtp/types";
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
}
