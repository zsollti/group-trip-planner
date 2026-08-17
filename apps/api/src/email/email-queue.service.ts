import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import {
  emailDedupeKey,
  MAX_EMAIL_ATTEMPTS,
  nextRetryDelayMs,
  resolveLocale,
  SENDING_RECLAIM_MS,
  shouldSendMentionEmail,
  type Locale,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "./email.service.js";
import { createUnsubscribeToken } from "./unsubscribe.token.js";

/** How many due jobs one worker pass takes. Small: a pass runs every minute. */
const BATCH_SIZE = 25;

/** The denormalized snapshot a queued mention email renders from. */
export interface MentionEmailPayload {
  tripId: string;
  tripName: string;
  actorName: string;
  excerpt: string;
  /**
   * The recipient's language, snapshotted with everything else rather than looked
   * up at send time.
   *
   * Consistent with the rest of this payload — the trip name and the excerpt are
   * snapshots too — and it costs no extra query, since the enqueue path already
   * reads the row it gates on. The trade is that someone who changes language
   * while a mention is still queued gets the old one, which is a few seconds of
   * exposure on a preference they just set for themselves.
   *
   * Optional because rows queued before this field existed are still in the
   * table; those fall back to the source language.
   */
  locale?: Locale;
}

/**
 * The async notification-email queue (Phase 5.2, FR-35).
 *
 * **Why a table and not an in-process job:** sending inline would put a
 * third-party HTTP call on the chat-message path — slow when the provider is
 * slow, lost on a restart, and un-retryable. A row survives a crash, a redeploy,
 * and a provider outage.
 *
 * Three guarantees, each with one mechanism behind it:
 *
 * 1. **Exactly one email per event per recipient** — the `dedupeKey` UNIQUE
 *    index plus `skipDuplicates`. Idempotency lives in the database, so a
 *    retried fan-out, a redelivered socket event, or two API instances racing
 *    all converge on one row. Send-side, `SENT` rows are never re-claimed.
 * 2. **Retry with backoff** — a failed attempt bumps `attempts` and pushes
 *    `runAfter` out by the pure {@link nextRetryDelayMs} schedule, until
 *    {@link MAX_EMAIL_ATTEMPTS} parks the job as `FAILED`.
 * 3. **No lost claims** — claiming is an atomic compare-and-set (the same idiom
 *    as the Phase-2.4 lock): `updateMany` from `PENDING` → `SENDING` only
 *    matches rows nobody else has taken, so two workers cannot send the same
 *    email. A worker that dies mid-send leaves a `SENDING` row, which a later
 *    pass reclaims once {@link SENDING_RECLAIM_MS} has elapsed.
 *
 * Preference gating happens here at **enqueue** time (see
 * {@link shouldSendMentionEmail}) — never at send time, so everything queued is
 * mail that is meant to go out.
 */
@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Queue mention emails for the recipients who want them.
   *
   * Called after the message and its in-app notifications have committed, and
   * **best-effort** for the same reason fan-out is: a queue failure must not
   * roll back a chat message. Costs one query for the recipients' preferences
   * plus one insert, both scoped to the handful of people actually mentioned.
   */
  async enqueueMentionEmails(input: {
    tripId: string;
    tripName: string;
    actorName: string;
    /** The message id — the event this dedupes on. */
    messageId: string;
    excerpt: string;
    /** Already actor-excluded and membership-filtered by 5.1's fan-out rule. */
    recipientIds: string[];
  }): Promise<number> {
    if (input.recipientIds.length === 0) return 0;
    try {
      // One query: each recipient's address + global toggle + this trip's mute.
      const users = await this.prisma.user.findMany({
        where: { id: { in: input.recipientIds } },
        select: {
          id: true,
          email: true,
          emailVerified: true,
          emailOnMention: true,
          anonymizedAt: true,
          locale: true,
          memberships: {
            where: { tripId: input.tripId },
            select: { muted: true },
          },
        },
      });

      // Everything about the *event*, which every recipient shares. The one
      // per-recipient field — their language — is added per job below.
      const event = {
        tripId: input.tripId,
        tripName: input.tripName,
        actorName: input.actorName,
        excerpt: input.excerpt,
      };
      const jobs = users
        .filter((user) =>
          shouldSendMentionEmail({
            userId: user.id,
            emailOnMention: user.emailOnMention,
            tripMuted: user.memberships[0]?.muted ?? false,
            emailVerified: user.emailVerified,
            hasAddress: user.anonymizedAt === null && Boolean(user.email),
          }),
        )
        .map((user) => {
          const payload: MentionEmailPayload = {
            ...event,
            locale: resolveLocale(user.locale),
          };
          return {
            dedupeKey: emailDedupeKey({
              type: "MENTION" as const,
              eventId: input.messageId,
              recipientId: user.id,
            }),
            type: "MENTION" as const,
            to: user.email,
            userId: user.id,
            payload: payload as unknown as Prisma.InputJsonValue,
          };
        });
      if (jobs.length === 0) return 0;

      // skipDuplicates + the UNIQUE dedupeKey is the whole idempotency story:
      // a second enqueue for the same message inserts nothing.
      const { count } = await this.prisma.emailJob.createMany({
        data: jobs,
        skipDuplicates: true,
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `mention email enqueue failed for message ${input.messageId}: ${String(err)}`,
      );
      return 0;
    }
  }

  /**
   * One worker pass: claim up to {@link BATCH_SIZE} due jobs and send them.
   * Returns how many were sent successfully. Safe to run concurrently with
   * itself — claiming is atomic.
   */
  async processDueJobs(now: Date = new Date()): Promise<number> {
    const claimed = await this.claimDueJobs(now);
    let sent = 0;
    for (const job of claimed) {
      if (await this.deliver(job)) sent += 1;
    }
    return sent;
  }

  /**
   * Take ownership of due work. Two things are due: `PENDING` jobs whose backoff
   * has elapsed, and `SENDING` jobs abandoned by a dead worker (claimed longer
   * ago than {@link SENDING_RECLAIM_MS}).
   *
   * The claim is per-row compare-and-set, not a bulk update: `updateMany`
   * filtered on the id **and** the status/claim we selected it with. A row that
   * another worker took between our select and our update simply matches
   * nothing, and we skip it rather than sending it twice.
   */
  private async claimDueJobs(now: Date) {
    const reclaimBefore = new Date(now.getTime() - SENDING_RECLAIM_MS);
    const candidates = await this.prisma.emailJob.findMany({
      where: {
        OR: [
          { status: "PENDING", runAfter: { lte: now } },
          { status: "SENDING", claimedAt: { lt: reclaimBefore } },
        ],
      },
      orderBy: { runAfter: "asc" },
      take: BATCH_SIZE,
    });

    const claimed: typeof candidates = [];
    for (const job of candidates) {
      const { count } = await this.prisma.emailJob.updateMany({
        where:
          job.status === "PENDING"
            ? { id: job.id, status: "PENDING" }
            : { id: job.id, status: "SENDING", claimedAt: job.claimedAt },
        data: { status: "SENDING", claimedAt: now },
      });
      if (count === 1) claimed.push(job);
    }
    return claimed;
  }

  /** Send one claimed job and record the outcome. Never throws. */
  private async deliver(job: {
    id: string;
    to: string;
    userId: string | null;
    attempts: number;
    payload: Prisma.JsonValue;
  }): Promise<boolean> {
    try {
      const payload = job.payload as unknown as MentionEmailPayload;
      await this.email.sendMentionEmail({
        to: job.to,
        tripName: payload.tripName,
        actorName: payload.actorName,
        excerpt: payload.excerpt,
        tripId: payload.tripId,
        locale: payload.locale,
        // Minted per send, so a rotated JWT_SECRET invalidates old links.
        unsubscribeToken: createUnsubscribeToken(
          job.userId ?? "",
          this.env.JWT_SECRET,
        ),
      });
      await this.prisma.emailJob.update({
        where: { id: job.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: job.attempts + 1,
          claimedAt: null,
          lastError: null,
        },
      });
      return true;
    } catch (err) {
      await this.recordFailure(job.id, job.attempts, err);
      return false;
    }
  }

  /** Reschedule a failed job, or park it once the attempts are spent. */
  private async recordFailure(
    jobId: string,
    priorAttempts: number,
    err: unknown,
  ): Promise<void> {
    const attempts = priorAttempts + 1;
    const exhausted = attempts >= MAX_EMAIL_ATTEMPTS;
    const message = String(err).slice(0, 500);
    await this.prisma.emailJob.update({
      where: { id: jobId },
      data: {
        attempts,
        lastError: message,
        claimedAt: null,
        status: exhausted ? "FAILED" : "PENDING",
        ...(exhausted
          ? {}
          : { runAfter: new Date(Date.now() + nextRetryDelayMs(attempts)) }),
      },
    });
    this.logger.warn(
      exhausted
        ? `email job ${jobId} failed permanently after ${attempts} attempts: ${message}`
        : `email job ${jobId} attempt ${attempts} failed, retrying: ${message}`,
    );
  }

  /**
   * Run every minute. The interval is the delivery latency floor for a mention
   * email — a minute is imperceptible for notification mail and keeps the queue
   * query cheap.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    try {
      await this.processDueJobs();
    } catch (err) {
      this.logger.warn(`email queue pass failed: ${String(err)}`);
    }
  }
}
