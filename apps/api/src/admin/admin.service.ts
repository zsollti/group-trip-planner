import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { stat, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AdminAuditAction,
  AdminAuditLog,
  AdminEmail,
  AdminOverview,
  AdminRates,
  AdminSystem,
  AdminUserLookup,
  AdminUserSummary,
  AdminVolume,
} from "@gtp/types";
import { CONTRACT_VERSION, SENDING_RECLAIM_MS } from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "../email/email.service.js";
import { TokenService } from "../auth/token.service.js";

/** How many days of signup history the sparkline covers. */
const SIGNUP_DAYS = 30;
/** How many recent mail failures are worth showing at a glance. */
const FAILURE_SAMPLE = 10;
/** Lookup results, capped — this is a support tool, not an export. */
const LOOKUP_LIMIT = 10;

/**
 * Which commit this API is running, or null when it cannot know.
 *
 * Read once at module load, because it cannot change while the process lives.
 *
 * The deploy writes `build.txt` next to the app, mirroring what it already does
 * for the web bundle. It has to: the pipeline ships with `railway up`, which
 * uploads a directory rather than deploying a git ref, so Railway never fills
 * in its own `RAILWAY_GIT_COMMIT_SHA` and the API had no way to name its build
 * at all. The env vars are still checked first so any other host can stamp it
 * without a file.
 *
 * Null in local development, and shown as "unstamped" rather than guessed at —
 * a console that invents a build identity is worse than one that admits it has
 * none, since the whole reason to look is to check what is actually deployed.
 */
const COMMIT: string | null = (() => {
  const fromEnv = process.env.GIT_COMMIT ?? process.env.RAILWAY_GIT_COMMIT_SHA;
  if (fromEnv?.trim()) return fromEnv.trim();
  try {
    const stamped = readFileSync("build.txt", "utf8").trim();
    return stamped.length > 0 ? stamped : null;
  } catch {
    return null;
  }
})();

function readCommit(): string | null {
  return COMMIT;
}

/** Midnight-UTC `YYYY-MM-DD` for a day offset from today. */
function dayKey(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * The operator's console.
 *
 * Reads are aggregates and metadata only — no option titles, no messages, no
 * amounts. See the contract's own note for why that boundary is structural
 * rather than a matter of restraint.
 */
@Injectable()
export class AdminService {
  /** When this process came up — the API's answer to "did it restart-loop". */
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async overview(): Promise<AdminOverview> {
    // Independent aggregates over four unrelated concerns; there is no reason
    // for any of them to wait on the others.
    const [system, volume, email, rates] = await Promise.all([
      this.system(),
      this.volume(),
      this.email_(),
      this.rates(),
    ]);
    return { system, volume, email, rates };
  }

  private system(): AdminSystem {
    return {
      contractVersion: CONTRACT_VERSION,
      commit: readCommit(),
      startedAt: this.startedAt.toISOString(),
      nodeVersion: process.version,
      environment: this.env.NODE_ENV,
    };
  }

  private async volume(): Promise<AdminVolume> {
    const since = new Date(`${dayKey(-(SIGNUP_DAYS - 1))}T00:00:00.000Z`);
    const [
      users,
      verifiedUsers,
      trips,
      activeTrips,
      options,
      messages,
      recent,
      uploadBytes,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.trip.count(),
      this.prisma.trip.count({ where: { status: "ACTIVE" } }),
      this.prisma.option.count({ where: { deletedAt: null } }),
      this.prisma.message.count(),
      this.prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.uploadBytes(),
    ]);

    // Zero-filled, because a sparkline built only from days that had a signup
    // draws a busy month and a quiet one identically.
    const counts = new Map<string, number>();
    for (let i = SIGNUP_DAYS - 1; i >= 0; i--) counts.set(dayKey(-i), 0);
    for (const u of recent) {
      const key = u.createdAt.toISOString().slice(0, 10);
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      users,
      verifiedUsers,
      trips,
      activeTrips,
      options,
      messages,
      uploadBytes,
      signups: [...counts].map(([date, count]) => ({ date, count })),
    };
  }

  /**
   * Bytes held under `UPLOAD_DIR`, walked one level deep.
   *
   * Null rather than zero when the directory cannot be read: on a fresh deploy
   * it may not exist yet, and reporting "0 bytes" for "I could not look" would
   * be the console stating something false about the disk it exists to watch.
   */
  private async uploadBytes(): Promise<number | null> {
    try {
      const root = this.env.UPLOAD_DIR;
      const entries = await readdir(root, { withFileTypes: true });
      let total = 0;
      for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
          const inner = await readdir(path, { withFileTypes: true });
          for (const file of inner) {
            if (!file.isFile()) continue;
            total += (await stat(join(path, file.name))).size;
          }
        } else if (entry.isFile()) {
          total += (await stat(path)).size;
        }
      }
      return total;
    } catch {
      return null;
    }
  }

  /** Named with a trailing underscore: `email` is already the injected service. */
  private async email_(): Promise<AdminEmail> {
    const staleClaim = new Date(Date.now() - SENDING_RECLAIM_MS);
    const [pending, sending, sent, failed, stuckSending, recentFailures] =
      await Promise.all([
        this.prisma.emailJob.count({ where: { status: "PENDING" } }),
        this.prisma.emailJob.count({ where: { status: "SENDING" } }),
        this.prisma.emailJob.count({ where: { status: "SENT" } }),
        this.prisma.emailJob.count({ where: { status: "FAILED" } }),
        this.prisma.emailJob.count({
          where: { status: "SENDING", claimedAt: { lt: staleClaim } },
        }),
        this.prisma.emailJob.findMany({
          where: { status: "FAILED" },
          orderBy: { updatedAt: "desc" },
          take: FAILURE_SAMPLE,
          select: {
            id: true,
            to: true,
            type: true,
            attempts: true,
            lastError: true,
            updatedAt: true,
          },
        }),
      ]);

    return {
      pending,
      sending,
      sent,
      failed,
      stuckSending,
      configured: Boolean(this.env.RESEND_API_KEY),
      recentFailures: recentFailures.map((job) => ({
        id: job.id,
        to: job.to,
        type: job.type,
        attempts: job.attempts,
        lastError: job.lastError,
        updatedAt: job.updatedAt.toISOString(),
      })),
    };
  }

  private async rates(): Promise<AdminRates> {
    const [currencies, newest] = await Promise.all([
      this.prisma.exchangeRate.count(),
      this.prisma.exchangeRate.findFirst({ orderBy: { fetchedAt: "desc" } }),
    ]);
    return {
      configured: Boolean(this.env.EXCHANGE_RATES_URL),
      currencies,
      // `asOf` is a `date` column, so it arrives as midnight UTC and means a
      // calendar day — sliced, never formatted as an instant.
      asOf: newest ? newest.asOf.toISOString().slice(0, 10) : null,
      fetchedAt: newest ? newest.fetchedAt.toISOString() : null,
      source: newest?.source ?? null,
    };
  }

  /**
   * Find people by email or display name, or by exact id.
   *
   * Substring and case-insensitive, because the realistic input is a fragment
   * someone read out over a call, not a well-formed address.
   */
  async lookupUsers(query: string): Promise<AdminUserLookup> {
    const q = query.trim();
    if (!q) return { users: [] };

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          // A bare id pasted from a log or a URL. Guarded, because Postgres
          // rejects a malformed uuid as a type error rather than matching
          // nothing — one stray character would 500 the whole lookup.
          ...(/^[0-9a-f-]{36}$/i.test(q) ? [{ id: q }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: LOOKUP_LIMIT,
      include: {
        _count: { select: { memberships: true } },
        emailJobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            type: true,
            status: true,
            attempts: true,
            lastError: true,
            sentAt: true,
            createdAt: true,
          },
        },
        refreshTokens: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return {
      users: users.map(
        (u): AdminUserSummary => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          emailVerified: u.emailVerified,
          createdAt: u.createdAt.toISOString(),
          anonymizedAt: u.anonymizedAt?.toISOString() ?? null,
          hasPassword: u.passwordHash !== null,
          tripCount: u._count.memberships,
          lastSeenAt: u.refreshTokens[0]?.createdAt.toISOString() ?? null,
          emailJobs: u.emailJobs.map((j) => ({
            id: j.id,
            type: j.type,
            status: j.status,
            attempts: j.attempts,
            lastError: j.lastError,
            sentAt: j.sentAt?.toISOString() ?? null,
            createdAt: j.createdAt.toISOString(),
          })),
        }),
      ),
    };
  }

  /**
   * Send a fresh verification link to someone who says they never got one.
   *
   * Issues a **new** token rather than re-sending the old one, because the old
   * one may well have expired — which is the most likely reason for the
   * complaint in the first place.
   */
  async resendVerification(
    actorEmail: string,
    userId: string,
  ): Promise<AdminUserSummary> {
    const user = await this.requireUser(userId);
    const rawToken = await this.tokens.issueEmailVerificationToken(user.id);
    await this.email.sendVerificationEmail(user.email, rawToken);
    await this.record(actorEmail, "VERIFICATION_RESENT", user.email);
    return this.summaryOf(user.id);
  }

  /**
   * Mark an account verified by hand.
   *
   * The escape hatch for when the mail genuinely cannot be delivered — a
   * corporate filter, a dead domain — and the person is otherwise stuck behind
   * every verified-gated action. It is the most consequential thing this
   * console can do, which is why it writes an audit row naming the operator.
   */
  async markVerified(
    actorEmail: string,
    userId: string,
  ): Promise<AdminUserSummary> {
    const user = await this.requireUser(userId);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    await this.record(actorEmail, "USER_MARKED_VERIFIED", user.email);
    return this.summaryOf(user.id);
  }

  /** The console's own history, newest first. */
  async auditLog(): Promise<AdminAuditLog> {
    const rows = await this.prisma.adminAuditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action as AdminAuditAction,
        actorEmail: r.actorEmail,
        subject: r.subject,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Write one operator action to the console's own log. */
  async record(
    actorEmail: string,
    action: AdminAuditAction,
    subject: string | null,
  ): Promise<void> {
    await this.prisma.adminAuditEvent.create({
      data: { action, actorEmail, subject },
    });
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("No such user.");
    return user;
  }

  /** Re-read one user in the lookup's shape, so an action can answer with it. */
  private async summaryOf(userId: string): Promise<AdminUserSummary> {
    const { users } = await this.lookupUsers(userId);
    const found = users.find((u) => u.id === userId);
    if (!found) throw new NotFoundException("No such user.");
    return found;
  }
}
