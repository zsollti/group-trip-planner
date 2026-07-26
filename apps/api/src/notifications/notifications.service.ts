import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  NOTIFICATION_NEW_EVENT,
  notificationRecipients,
  type NotificationPage,
  type NotificationType,
} from "@gtp/types";
import { EmailQueueService } from "../email/email-queue.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import {
  toNotificationView,
  type NotificationPayload,
} from "./notification.mapper.js";

/** Default and maximum page size for the cursor-paged bell. */
const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

/** Longest mention excerpt stored in a payload — enough to recognise the message
 * in the bell without copying an entire chat message into every recipient's row. */
const EXCERPT_LIMIT = 140;

/** What a trigger hands over to fan out. The caller supplies the display strings
 * it already holds, so fan-out costs one member query and one insert. */
export interface NotifyInput {
  tripId: string;
  tripName: string;
  actorId: string;
  actorName: string;
  type: NotificationType;
  /** Option title, or the message excerpt for a mention. */
  subject: string;
  categoryId?: string | null;
  channelId?: string | null;
  /** Mentioned user ids — only consulted for `MENTION`. */
  mentionedUserIds?: string[];
  /**
   * Id of the thing that happened — the message id for a mention. Only used to
   * dedupe the **email** channel (Phase 5.2): it is what makes "one message =
   * one email per recipient" hold across a retried or redelivered fan-out.
   */
  eventId?: string;
}

/**
 * In-app notifications (Phase 5.1) — the always-on channel. Two responsibilities:
 *
 *  1. **Fan-out.** {@link notify} resolves the recipients through the pure
 *     {@link notificationRecipients} rule (never the actor), materializes one row
 *     per recipient, and pushes each live into that user's personal socket room.
 *     It is called **after** the triggering action has committed and is
 *     deliberately *best-effort*: any failure is logged and swallowed, because a
 *     notification must never roll back a lock, a proposal, or a chat message.
 *  2. **Reads.** The bell's cursor-paged list, the unread count, and the
 *     idempotent mark-read — all strictly scoped to the calling user, so a
 *     notification id belonging to someone else is a 404, never a read.
 *
 * The **in-app** channel is always on and never preference-gated. Phase 5.2 adds
 * a second, optional channel: after fan-out, a `MENTION` also hands its
 * recipients to {@link EmailQueueService}, which applies the email preferences.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly emailQueue: EmailQueueService,
  ) {}

  /** Trim a chat message down to a bell-sized excerpt. */
  static excerpt(body: string): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > EXCERPT_LIMIT
      ? `${flat.slice(0, EXCERPT_LIMIT - 1)}…`
      : flat;
  }

  /**
   * Fan a trigger out to its recipients and push it live. Never throws — see the
   * class doc: the triggering action has already committed and must stand on its
   * own.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const members = await this.prisma.tripMembership.findMany({
        where: { tripId: input.tripId },
        select: { userId: true },
      });
      const recipients = notificationRecipients({
        type: input.type,
        actorId: input.actorId,
        members,
        mentionedUserIds: input.mentionedUserIds,
      });
      if (recipients.length === 0) return;

      const payload: NotificationPayload = {
        tripName: input.tripName,
        actorName: input.actorName,
        subject: input.subject,
        categoryId: input.categoryId ?? null,
        channelId: input.channelId ?? null,
      };
      // createManyAndReturn keeps fan-out to a single insert while still handing
      // back the stored rows (ids + timestamps) needed for the live push.
      const created = await this.prisma.notification.createManyAndReturn({
        data: recipients.map((userId) => ({
          userId,
          tripId: input.tripId,
          type: input.type,
          payload: payload as unknown as Prisma.InputJsonValue,
        })),
      });
      for (const row of created) {
        this.realtime.emitToUser(
          row.userId,
          NOTIFICATION_NEW_EVENT,
          toNotificationView(row),
        );
      }
      await this.enqueueEmails(input, recipients);
    } catch (err) {
      this.logger.warn(
        `notification fan-out failed for trip ${input.tripId}: ${String(err)}`,
      );
    }
  }

  /**
   * Hand the in-app recipients to the email queue (Phase 5.2). Only `MENTION`
   * has an email channel — a proposal or a lock notifies in-app and stops there,
   * so an active trip never turns into a mail flood.
   *
   * The queue applies the per-recipient preference gate itself; this method's
   * only job is to pass along what it already loaded. `eventId` is required for
   * the dedupe key, so a caller that omits it simply gets no email rather than a
   * key that cannot dedupe.
   */
  private async enqueueEmails(
    input: NotifyInput,
    recipients: string[],
  ): Promise<void> {
    if (input.type !== "MENTION" || !input.eventId) return;
    await this.emailQueue.enqueueMentionEmails({
      tripId: input.tripId,
      tripName: input.tripName,
      actorName: input.actorName,
      messageId: input.eventId,
      excerpt: input.subject,
      recipientIds: recipients,
    });
  }

  /** One page of the caller's notifications, newest first, plus their total
   * unread count (which spans every page, so the badge is always right). */
  async list(
    userId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<NotificationPage> {
    const take = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1, // one extra row tells us whether an older page exists
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      notifications: page.map(toNotificationView),
      unreadCount,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Mark one notification read (idempotent). The `userId` in the filter is the
   * ownership check: another user's id simply matches nothing → 404, so a
   * notification can never be read (or marked) across accounts.
   */
  async markRead(userId: string, notificationId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      // Either already read (fine — idempotent) or not ours (404).
      const exists = await this.prisma.notification.findFirst({
        where: { id: notificationId, userId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Notification not found");
    }
    return this.unreadCount(userId);
  }

  /** Mark everything the caller has unread as read; returns the new count (0). */
  async markAllRead(userId: string): Promise<number> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.unreadCount(userId);
  }

  private unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }
}
