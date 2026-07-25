import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TripRole } from "@prisma/client";
import {
  canDeleteMessage,
  type MessagePage,
  type MessageView,
  type ReactionUpdate,
  resolveMentions,
  type SendMessageInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  groupReactions,
  messageInclude,
  toMessageView,
} from "./message.mapper.js";

/** Default and maximum page size for cursor-paged channel history. */
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

/**
 * Messages domain service (Phase 4.2). Owns posting, soft-delete, and the
 * cursor-paged history read. Authorization for posting is coarse (any member —
 * enforced upstream: the socket handshake for live send, the PermissionGuard for
 * the REST history read); the target-scoped delete rule (own vs any) is enforced
 * here via {@link canDeleteMessage}. Chat is **exempt from the History freeze**
 * (FR-10) — there is deliberately no Active-trip check on posting.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a channel and assert it belongs to `tripId` (else 404). Guards the
   * cross-trip hole: a member of one trip must not post to another's channel. */
  private async channelInTrip(channelId: string, tripId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel || channel.tripId !== tripId) {
      throw new NotFoundException("Channel not found");
    }
    return channel;
  }

  /** Load a message and assert its channel belongs to `tripId` (else 404). */
  private async messageInTrip(messageId: string, tripId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    if (!message) throw new NotFoundException("Message not found");
    await this.channelInTrip(message.channelId, tripId);
    return message;
  }

  /**
   * Persist a message (author already known to be a member) and resolve its
   * `@mentions` against the trip's members in the **same transaction** — the
   * mention rows are captured for Phase-5 notification delivery (FR-32); delivery
   * itself is deferred. Returns the view that is both ack'd to the sender and
   * broadcast to the room.
   */
  async post(
    tripId: string,
    authorId: string,
    input: SendMessageInput,
  ): Promise<MessageView> {
    await this.channelInTrip(input.channelId, tripId);

    const members = await this.prisma.tripMembership.findMany({
      where: { tripId },
      select: { userId: true, user: { select: { displayName: true } } },
    });
    const mentionIds = resolveMentions(
      input.body,
      members.map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
      })),
    );

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { channelId: input.channelId, authorId, body: input.body },
        select: { id: true },
      });
      if (mentionIds.length > 0) {
        await tx.mention.createMany({
          data: mentionIds.map((userId) => ({
            messageId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        include: messageInclude,
      });
    });
    return toMessageView(message);
  }

  /** Add the caller's reaction (idempotent) and return the message's refreshed
   * public reaction groups to broadcast. Any member may react (Phase 4.3). */
  async addReaction(
    tripId: string,
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionUpdate> {
    await this.messageInTrip(messageId, tripId);
    await this.prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, userId, emoji },
      update: {},
    });
    return this.reactionsFor(messageId);
  }

  /** Remove the caller's reaction (idempotent) and return the refreshed groups. */
  async removeReaction(
    tripId: string,
    userId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionUpdate> {
    await this.messageInTrip(messageId, tripId);
    await this.prisma.reaction.deleteMany({
      where: { messageId, userId, emoji },
    });
    return this.reactionsFor(messageId);
  }

  private async reactionsFor(messageId: string): Promise<ReactionUpdate> {
    const rows = await this.prisma.reaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });
    return { messageId, reactions: groupReactions(rows) };
  }

  /**
   * Soft-delete a message → tombstone. The author may delete their own; an
   * Organizer may delete anyone's ({@link canDeleteMessage}). Idempotent: a
   * re-delete returns the existing tombstone. Returns the tombstone view to
   * broadcast to the room.
   */
  async softDelete(
    tripId: string,
    userId: string,
    role: TripRole,
    messageId: string,
  ): Promise<MessageView> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    // Scope to this trip's channels so an id from another trip is a plain 404.
    if (!message) throw new NotFoundException("Message not found");
    await this.channelInTrip(message.channelId, tripId);

    if (!canDeleteMessage(role, message.authorId === userId)) {
      throw new ForbiddenException("You can't delete this message");
    }
    if (message.deletedAt) return toMessageView(message);

    const tombstoned = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: userId },
      include: messageInclude,
    });
    return toMessageView(tombstoned);
  }

  /**
   * Cursor-paged channel history, **newest-first** and stable under new
   * messages (a newly posted message never shifts an older page). The `cursor`
   * is an opaque message id (the oldest of the previous page); the returned
   * `nextCursor` is the oldest id of this page, or null at the channel start.
   * Tombstones are included (deleted rows still render).
   */
  async history(
    tripId: string,
    channelId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<MessagePage> {
    await this.channelInTrip(channelId, tripId);
    const take = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);

    const rows = await this.prisma.message.findMany({
      where: { channelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1, // one extra row tells us whether an older page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: messageInclude,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      messages: page.map(toMessageView),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
