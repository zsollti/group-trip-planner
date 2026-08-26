import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  CHANNEL_CREATED_EVENT,
  CHANNELS_DELETED_EVENT,
  type ChannelUnread,
  type ChannelView,
  CHAT_MUTE_MINUTES,
  type ChatMuteDuration,
  type ChatMuteView,
  type ChatReadyPayload,
  type TripChatMute,
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
    const [channels, lastMessage] = await Promise.all([
      this.prisma.channel.findMany({
        where: { tripId },
        orderBy: { createdAt: "asc" },
      }),
      this.lastMessageByChannel([tripId]),
    ]);
    return channels.map((c) => toChannelView(c, lastMessage.get(c.id) ?? null));
  }

  /**
   * When each of the trip's channels last had something said in it, for
   * {@link ChannelView.lastMessageAt}. Deleted messages don't count: a channel
   * whose only message was withdrawn has had nothing said in it.
   *
   * One `groupBy` for the whole trip, in the same spirit as the unread aggregate
   * below — a query per channel would fan out with the board, and channels are
   * per-category and on-demand.
   */
  private async lastMessageByChannel(
    tripIds: readonly string[],
  ): Promise<Map<string, Date>> {
    const rows = await this.prisma.message.groupBy({
      by: ["channelId"],
      where: { channel: { tripId: { in: [...tripIds] } }, deletedAt: null },
      _max: { createdAt: true },
    });
    return new Map(
      rows.flatMap((row) =>
        row._max.createdAt
          ? [[row.channelId, row._max.createdAt] as const]
          : [],
      ),
    );
  }

  /** {@link lastMessageByChannel} for a single channel — the reopen path, which
   *  has one channel in hand and no reason to aggregate the whole trip. */
  private async lastMessageIn(channelId: string): Promise<Date | null> {
    const row = await this.prisma.message.findFirst({
      where: { channelId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /**
   * The ready payload for a connecting member (Phase 4.4): the channels plus
   * their per-channel unread counts. Unread = non-deleted messages after the
   * member's read cursor (`ChannelRead.lastReadAt`) authored by **someone else**
   * — you're never unread on your own messages, and a never-read channel counts
   * everything.
   */
  async readyPayload(
    tripIds: readonly string[],
    userId: string,
  ): Promise<ChatReadyPayload> {
    // Nothing to ask about. Worth returning early rather than letting an empty
    // `IN ()` reach Postgres: a member of no board with chat is an ordinary
    // state (a brand-new account, or one that is Guest everywhere), not a
    // degenerate one.
    if (tripIds.length === 0) return { channels: [], unread: [], mutes: [] };

    const [channels, lastMessage, mutes] = await Promise.all([
      this.prisma.channel.findMany({
        where: { tripId: { in: [...tripIds] } },
        orderBy: { createdAt: "asc" },
      }),
      this.lastMessageByChannel(tripIds),
      this.mutesFor(tripIds, userId),
    ]);

    // One aggregate for every board the reader is on, rather than a count per
    // channel (Phase 7.3) or a round trip per trip. Each channel has its *own*
    // cutoff — the member's read cursor — which is why this is raw SQL: the
    // per-row comparison against `channel_reads` cannot be expressed as a
    // single Prisma `groupBy`, and the shape before that fanned out into one
    // COUNT per channel on every socket connect. Channels became per-category
    // and on-demand in 4.5, so that fan-out grows with the board — and now that
    // one socket covers every board at once, it would have grown with the
    // account as well. `ANY(...)` keeps it a single statement whatever the
    // reader is a member of. The LEFT JOIN keeps never-read channels (NULL
    // cursor counts all). Values are bound as parameters by the tagged
    // template, never interpolated.
    const counts = await this.prisma.$queryRaw<
      { channelId: string; count: bigint }[]
    >`
      SELECT m."channelId" AS "channelId", COUNT(*) AS "count"
      FROM "messages" m
      JOIN "channels" c ON c."id" = m."channelId"
      LEFT JOIN "channel_reads" r
        ON r."channelId" = m."channelId" AND r."userId" = ${userId}::uuid
      WHERE c."tripId" = ANY(${[...tripIds]}::uuid[])
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

    return {
      channels: channels.map((c) =>
        toChannelView(c, lastMessage.get(c.id) ?? null),
      ),
      unread,
      mutes,
    };
  }

  /**
   * The boards this reader has silenced, of the ones asked about.
   *
   * **Only the muted ones are returned**, so the payload is the size of the
   * exception rather than the size of the membership list. An absent trip is an
   * unmuted trip, which is also what a client that has never heard of mutes
   * would assume.
   *
   * A lapsed timed mute is filtered out here rather than being cleared from the
   * row. Writing on a read would turn every socket connect into a write, and
   * the row is harmless: `chatMutedUntil` in the past means the same thing as
   * no mute at all, and the next mute overwrites it. The client is sent the
   * instant as well as the flag so it can let a mute lapse mid-session without
   * waiting for a reconnect.
   */
  private async mutesFor(
    tripIds: readonly string[],
    userId: string,
  ): Promise<TripChatMute[]> {
    const rows = await this.prisma.tripMembership.findMany({
      where: { userId, tripId: { in: [...tripIds] }, chatMuted: true },
      select: { tripId: true, chatMutedUntil: true },
    });
    const now = Date.now();
    return rows
      .filter((r) => !r.chatMutedUntil || r.chatMutedUntil.getTime() > now)
      .map((r) => ({
        tripId: r.tripId,
        muted: true,
        mutedUntil: r.chatMutedUntil?.toISOString() ?? null,
      }));
  }

  /**
   * Silence this board's chat for this member, or let it speak again.
   *
   * A single route for both directions, because they are one setting: a null
   * duration is "not muted", and the alternative — a POST to mute and a DELETE
   * to unmute — makes the client hold a state machine to decide which verb its
   * own menu item means.
   *
   * The expiry is computed here and stored as an instant, not as a duration
   * counted down from `updatedAt`. "Muted for an hour" asked at 14:00 means
   * quiet until 15:00 whatever happens in between, and a stored instant is the
   * only shape that stays true across a restart, a clock change on the reader's
   * device, or a second mute set while the first is running.
   */
  async setMute(
    tripId: string,
    userId: string,
    duration: ChatMuteDuration | null,
  ): Promise<ChatMuteView> {
    const until =
      duration === "HOUR" || duration === "DAY"
        ? new Date(Date.now() + CHAT_MUTE_MINUTES[duration] * 60_000)
        : null;
    // `updateMany` rather than `update`: the membership is addressed by the
    // pair, and a caller who is somehow not a member updates nothing instead of
    // raising a Prisma error about a record it should never have reached. The
    // guard already refused them; this simply does not depend on that.
    await this.prisma.tripMembership.updateMany({
      where: { tripId, userId },
      data: { chatMuted: duration !== null, chatMutedUntil: until },
    });
    return {
      muted: duration !== null,
      mutedUntil: until?.toISOString() ?? null,
    };
  }

  /** The mute as it stands, with a lapsed one read as no mute. */
  async getMute(tripId: string, userId: string): Promise<ChatMuteView> {
    const row = await this.prisma.tripMembership.findFirst({
      where: { tripId, userId },
      select: { chatMuted: true, chatMutedUntil: true },
    });
    const lapsed =
      !!row?.chatMutedUntil && row.chatMutedUntil.getTime() <= Date.now();
    if (!row?.chatMuted || lapsed) return { muted: false, mutedUntil: null };
    return {
      muted: true,
      mutedUntil: row.chatMutedUntil?.toISOString() ?? null,
    };
  }

  /**
   * Delete lane discussions from a board (post-launch, organizers).
   *
   * **The trip-wide channel is refused, not skipped.** Quietly dropping it from
   * the list would let a client tick it, press Delete, and be told the deletion
   * succeeded — with the board's General still there. A caller that asks for
   * something impossible is told so.
   *
   * Scoped by `tripId` in the same `where` that names the ids, so an id from
   * another board matches nothing rather than deleting somebody else's
   * conversation. That check and the delete are one statement; there is no
   * window between verifying and acting.
   *
   * The messages and read cursors go with them by FK cascade — the same cascade
   * that already takes a category's discussion when the category is deleted.
   *
   * Returns the ids actually deleted, which is what the broadcast carries and
   * what the caller reconciles against. An id that was already gone is not an
   * error: two organizers tidying the same board at once is a race with an
   * obvious right answer, and it is "the channel is gone", which is what both
   * of them wanted.
   */
  async deleteChannels(
    tripId: string,
    channelIds: readonly string[],
  ): Promise<string[]> {
    const found = await this.prisma.channel.findMany({
      where: { tripId, id: { in: [...channelIds] } },
      select: { id: true, type: true },
    });
    if (found.some((c) => c.type === "GENERAL")) {
      throw new BadRequestException(
        "The board's own conversation can't be deleted.",
      );
    }
    const ids = found.map((c) => c.id);
    if (ids.length === 0) return [];

    await this.prisma.channel.deleteMany({
      where: { tripId, id: { in: ids } },
    });
    // After the delete, never before: a client told to forget a channel that is
    // then still there has no way to learn otherwise short of a reconnect.
    this.realtime.emitToTrip(tripId, CHANNELS_DELETED_EVENT, {
      channelIds: ids,
    });
    return ids;
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
    // Reopening: the channel may well have history, so state it rather than
    // letting the default null claim the discussion is empty.
    if (existing) {
      return toChannelView(existing, await this.lastMessageIn(existing.id));
    }

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
