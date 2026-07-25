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
  type SendMessageInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { messageInclude, toMessageView } from "./message.mapper.js";

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

  /** Persist a message (author already known to be a member). Returns the view
   * that is both ack'd to the sender and broadcast to the room. */
  async post(
    tripId: string,
    authorId: string,
    input: SendMessageInput,
  ): Promise<MessageView> {
    await this.channelInTrip(input.channelId, tripId);
    const message = await this.prisma.message.create({
      data: {
        channelId: input.channelId,
        authorId,
        body: input.body,
      },
      include: messageInclude,
    });
    return toMessageView(message);
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
