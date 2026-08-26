import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TripRole } from "@prisma/client";
import {
  canDeleteMessage,
  MESSAGE_SEARCH_LIMIT,
  type MessagePage,
  type MessageSearchView,
  type MessageView,
  type ReactionUpdate,
  resolveMentions,
  type SendMessageInput,
} from "@gtp/types";
import { NotificationsService } from "../notifications/notifications.service.js";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

  /**
   * Which trip a channel belongs to, or null if there is no such channel.
   *
   * For the socket, which is no longer scoped to a board and so has to work out
   * what a request is *about* before it can decide whether the caller may make
   * it. Deliberately the server's own answer rather than a `tripId` added to
   * the message payload: a client that names both could name a mismatched
   * pair, and the assertions above would then be checking the caller's claim
   * against itself.
   */
  async tripOfChannel(channelId: string): Promise<string | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { tripId: true },
    });
    return channel?.tripId ?? null;
  }

  /** {@link tripOfChannel} for a message — the delete and react paths, which
   *  hold a message id and not a channel. */
  async tripOfMessage(messageId: string): Promise<string | null> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { channel: { select: { tripId: true } } },
    });
    return message?.channel.tripId ?? null;
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
    await this.notifyMentions(tripId, authorId, input.channelId, message, {
      mentionIds,
      members,
    });
    return toMessageView(message);
  }

  /**
   * Turn the stored mention rows into notifications (Phase 5.1) — the delivery
   * Phase 4.3 deliberately deferred. Only mentioned users are notified, never the
   * author (both rules live in the pure `notificationRecipients`), and only when
   * the message actually mentioned someone, so the ordinary chat path pays
   * nothing extra. Runs after the message has committed and is best-effort.
   *
   * The message **id** goes along as the notification's `eventId`: it is what
   * Phase 5.2's email queue dedupes on, so one message can only ever produce one
   * email per mentioned person.
   */
  private async notifyMentions(
    tripId: string,
    authorId: string,
    channelId: string,
    message: { id: string; body: string },
    ctx: {
      mentionIds: string[];
      members: { userId: string; user: { displayName: string } }[];
    },
  ): Promise<void> {
    if (ctx.mentionIds.length === 0) return;
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { name: true },
    });
    const author = ctx.members.find((m) => m.userId === authorId);
    await this.notifications.notify({
      tripId,
      tripName: trip?.name ?? "",
      actorId: authorId,
      actorName: author?.user.displayName ?? "",
      type: "MENTION",
      subject: NotificationsService.excerpt(message.body),
      channelId,
      mentionedUserIds: ctx.mentionIds,
      eventId: message.id,
    });
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

  /**
   * Messages strictly **after** the given anchor message, oldest-first (Phase
   * 4.4 reconnect catch-up, FR-32). The client hands its last-seen message id;
   * we return everything since, so a dropped connection recovers the gap and then
   * resumes the live stream — with no dupes (the anchor is excluded) and no gaps
   * (a total `(createdAt, id)` order). An unknown/foreign anchor yields nothing.
   */
  async since(
    tripId: string,
    channelId: string,
    afterId: string,
  ): Promise<MessageView[]> {
    await this.channelInTrip(channelId, tripId);
    const anchor = await this.prisma.message.findUnique({
      where: { id: afterId },
      select: { seq: true, channelId: true },
    });
    if (!anchor || anchor.channelId !== channelId) return [];

    const rows = await this.prisma.message.findMany({
      where: { channelId, seq: { gt: anchor.seq } },
      orderBy: { seq: "asc" },
      take: 200,
      include: messageInclude,
    });
    return rows.map(toMessageView);
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

  /**
   * Every message on this board whose text contains `term`, newest first.
   *
   * **The matching is raw SQL, the loading is not.** `ILIKE` is the right
   * operator and Prisma's `contains` compiles to it, but it interpolates the
   * search term into the pattern *unescaped* — so a reader searching for "50%"
   * or "a_b" is handing LIKE its own wildcards, and searching for "%" alone
   * returns the entire transcript. There is no escape option on `contains`, so
   * the ids come from a query that escapes the term itself and says `ESCAPE`,
   * and the rows are then loaded through the same `messageInclude` every other
   * read here uses. Two queries, one mapper, no second definition of what a
   * message is.
   *
   * Scoped by `tripId` in the SQL rather than by a channel list gathered
   * beforehand: the caller's permission is checked against the trip, so the
   * trip is the boundary, and a channel created between the two queries cannot
   * open a hole.
   */
  async search(tripId: string, term: string): Promise<MessageSearchView> {
    // The character class puts the backslash first for readability only — a
    // class matches each character once, so the escapes cannot escape each
    // other the way a chain of string replacements would.
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const found = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m."id"
      FROM "messages" m
      JOIN "channels" c ON c."id" = m."channelId"
      WHERE c."tripId" = ${tripId}::uuid
        AND m."deletedAt" IS NULL
        AND m."body" ILIKE ${pattern} ESCAPE '\\'
      ORDER BY m."seq" DESC
      LIMIT ${MESSAGE_SEARCH_LIMIT + 1}
    `;

    const truncated = found.length > MESSAGE_SEARCH_LIMIT;
    const ids = (truncated ? found.slice(0, MESSAGE_SEARCH_LIMIT) : found).map(
      (row) => row.id,
    );
    if (ids.length === 0) return { messages: [], truncated: false };

    const rows = await this.prisma.message.findMany({
      where: { id: { in: ids } },
      orderBy: { seq: "desc" },
      include: messageInclude,
    });
    return { messages: rows.map(toMessageView), truncated };
  }
}
