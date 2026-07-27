import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CHANNEL_CREATED_EVENT,
  type ChannelUnread,
  type ChannelView,
  type ChatReadyPayload,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { toChannelView } from "./channel.mapper.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Channels domain service (Phase 4.1). Owns the trip's chat channels: the
 * auto-created General channel (written inside trip creation) and, from Phase
 * 4.5, on-demand per-category channels. The read side (`listForTrip`) backs the
 * socket's ready payload.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

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

    // One aggregate for the whole trip rather than a count per channel (Phase
    // 7.3). Each channel has its *own* cutoff — the member's read cursor — which
    // is why this is raw SQL: the per-row comparison against `channel_reads`
    // cannot be expressed as a single Prisma `groupBy`, and the previous shape
    // fanned out into one COUNT per channel on every socket connect. Channels
    // became per-category and on-demand in 4.5, so that fan-out grows with the
    // board. The LEFT JOIN keeps never-read channels (NULL cursor counts all).
    // Values are bound as parameters by the tagged template, never interpolated.
    const counts = await this.prisma.$queryRaw<
      { channelId: string; count: bigint }[]
    >`
      SELECT m."channelId" AS "channelId", COUNT(*) AS "count"
      FROM "messages" m
      JOIN "channels" c ON c."id" = m."channelId"
      LEFT JOIN "channel_reads" r
        ON r."channelId" = m."channelId" AND r."userId" = ${userId}::uuid
      WHERE c."tripId" = ${tripId}::uuid
        AND m."deletedAt" IS NULL
        AND m."authorId" <> ${userId}::uuid
        AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
      GROUP BY m."channelId"
    `;
    // COUNT() comes back as bigint; the contract carries a plain number, and a
    // per-channel unread tally is far below Number.MAX_SAFE_INTEGER.
    const byChannel = new Map(
      counts.map((row) => [row.channelId, Number(row.count)]),
    );

    // Every channel appears, including those the aggregate had no rows for.
    const unread: ChannelUnread[] = channels.map((c) => ({
      channelId: c.id,
      count: byChannel.get(c.id) ?? 0,
    }));

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

  /**
   * Start (or reopen) a category's discussion channel (Phase 4.5, FR-29). Unlike
   * the General channel, category channels are **created on demand** — this is the
   * "start discussion" action, available to any member. It is **idempotent**: the
   * `Channel.categoryId` unique constraint means one channel per category, so a
   * second caller (or a race) resolves to the existing channel rather than a
   * duplicate. A newly-created channel is broadcast to the trip room so it appears
   * in every member's switcher live (the actor also gets it as the HTTP response).
   * The channel cascades away with its category (schema-level `onDelete: Cascade`).
   */
  async startCategoryDiscussion(
    tripId: string,
    categoryId: string,
  ): Promise<ChannelView> {
    if (!UUID_RE.test(categoryId)) {
      throw new NotFoundException("Category not found");
    }
    // The category must belong to this trip (a foreign id is a plain 404, never a
    // cross-trip channel). Guards run before pipes, so scope it here defensively.
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, tripId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException("Category not found");

    const existing = await this.prisma.channel.findUnique({
      where: { categoryId },
    });
    if (existing) return toChannelView(existing);

    try {
      const created = await this.prisma.channel.create({
        data: { tripId, categoryId, type: "CATEGORY" },
      });
      const view = toChannelView(created);
      this.realtime.emitToTrip(tripId, CHANNEL_CREATED_EVENT, view);
      return view;
    } catch {
      // Lost a create race — the other writer's channel is now the one truth.
      const now = await this.prisma.channel.findUniqueOrThrow({
        where: { categoryId },
      });
      return toChannelView(now);
    }
  }
}
