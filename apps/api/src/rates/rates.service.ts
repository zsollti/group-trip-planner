import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { RateTable } from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { RATES_PROVIDER, type RatesProvider } from "./rates.provider.js";

/** The stored snapshot, ready for the pure converter. */
export interface StoredRates {
  readonly rates: RateTable;
  /** The source's publication date, ISO `YYYY-MM-DD`. */
  readonly asOf: string;
}

/**
 * How long a stored snapshot is worth converting with.
 *
 * Rates are an approximation by design, and a few days old is still a decent
 * one — a week-old euro/forint rate will not mislead anyone deciding whether a
 * trip is affordable. A month-old one might, so past this the app stops
 * offering a conversion at all and falls back to the exact per-currency view,
 * which is never wrong. Being unable to answer beats answering badly.
 */
const MAX_AGE_DAYS = 30;

/** How long the in-process copy is trusted before the table is read again. */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * The daily exchange-rate snapshot: fetching it, storing it, and handing it out
 * (post-launch).
 *
 * Three properties this is built around, in order of how much they matter:
 *
 * 1. **A failed refresh changes nothing.** The last good rates stay in place and
 *    keep being served. There is no hardcoded fallback table anywhere — one
 *    would be wrong forever, silently, which is worse than being a week stale
 *    and saying so.
 * 2. **Without configuration it does nothing at all.** No `EXCHANGE_RATES_URL`
 *    means no provider, no fetch, an empty table and `converted: null` on every
 *    dashboard — which is precisely the app as it was before conversion existed.
 *    That also makes the whole test suite offline by construction: nothing sets
 *    the variable, so nothing reaches the network, and a CI run can never be
 *    flaky because a rate feed was slow. It mirrors how the mailer treats a
 *    missing Resend key.
 * 3. **The clock is an argument, never a global.** Staleness is decided against
 *    a `now` the caller passes, so every rule here is testable without waiting.
 */
@Injectable()
export class RatesService implements OnModuleInit {
  private readonly logger = new Logger(RatesService.name);
  private cache: { value: StoredRates | null; readAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATES_PROVIDER) private readonly provider: RatesProvider | null,
  ) {}

  /**
   * Catch up at boot, because a container is redeployed far more often than
   * once a day and would otherwise serve an empty table until the next tick.
   *
   * Deliberately not awaited: rates are a nice-to-have, and the API must come
   * up and serve traffic whether or not a third-party feed answers.
   */
  onModuleInit(): void {
    void this.refreshIfStale().catch(() => {
      /* already logged; boot never depends on this */
    });
  }

  /**
   * Hourly tick, but at most one fetch a day — the schedule is frequent so a
   * fresh deploy or a failed attempt recovers soon, while
   * {@link refreshIfStale} is what keeps it to a daily call.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.refreshIfStale().catch(() => {
      /* already logged */
    });
  }

  /** Fetch and store only when what we hold is not from today. */
  async refreshIfStale(now: Date = new Date()): Promise<boolean> {
    if (!this.provider) return false;
    const stored = await this.read();
    if (stored && stored.asOf === isoDay(now)) return false;
    return this.refresh();
  }

  /**
   * Fetch and store a snapshot. Returns whether anything was stored.
   *
   * The write is one transaction of upserts: a half-applied snapshot would mix
   * two days' rates inside a single conversion, which is a wrong number rather
   * than a stale one.
   */
  async refresh(): Promise<boolean> {
    if (!this.provider) return false;
    let snapshot;
    try {
      snapshot = await this.provider.fetchLatest();
    } catch (error) {
      // Expected failure, not an exception: the feed is a third party. Keep
      // the last good rates and say so at a level that will not page anyone.
      this.logger.warn(
        `Exchange-rate refresh failed, keeping the stored rates: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }

    const codes = Object.keys(snapshot.rates);
    const asOf = new Date(`${snapshot.asOf}T00:00:00.000Z`);
    await this.prisma.$transaction(
      codes.map((code) =>
        this.prisma.exchangeRate.upsert({
          where: { code },
          create: {
            code,
            perEur: snapshot.rates[code]!.toString(),
            asOf,
            source: "ecb",
          },
          update: {
            perEur: snapshot.rates[code]!.toString(),
            asOf,
            fetchedAt: new Date(),
            source: "ecb",
          },
        }),
      ),
    );
    this.cache = null;
    this.logger.log(
      `Stored ${codes.length} exchange rates as of ${snapshot.asOf}.`,
    );
    return true;
  }

  /**
   * The rates a conversion should use, or null when there are none worth using.
   *
   * Cached in process for a few minutes: a board refetches its dashboard on
   * every mutation, and re-reading thirty unchanging rows each time is the kind
   * of query this codebase has already gone hunting for twice.
   */
  async current(now: Date = new Date()): Promise<StoredRates | null> {
    const stored = await this.read();
    if (!stored) return null;
    if (ageInDays(stored.asOf, now) > MAX_AGE_DAYS) {
      // Old enough that a conversion could mislead. The exact per-currency
      // figures are still right, and that is what the UI falls back to.
      return null;
    }
    return stored;
  }

  /** Read the table, through the short-lived process cache. */
  private async read(): Promise<StoredRates | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.readAt < CACHE_TTL_MS) {
      return this.cache.value;
    }
    const rows = await this.prisma.exchangeRate.findMany();
    const value: StoredRates | null =
      rows.length === 0
        ? null
        : {
            rates: Object.fromEntries(
              rows.map((r) => [r.code, Number(r.perEur)]),
            ),
            // Every row of a snapshot carries the same date; a partially
            // applied write is impossible (one transaction), so the newest is
            // the snapshot's.
            asOf: isoDay(
              rows.reduce(
                (max, r) => (r.asOf > max ? r.asOf : max),
                rows[0]!.asOf,
              ),
            ),
          };
    this.cache = { value, readAt: now };
    return value;
  }
}

/** `YYYY-MM-DD` in UTC — the same calendar day the feed publishes against. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days between a stored publication date and now. */
function ageInDays(asOf: string, now: Date): number {
  const then = Date.parse(`${asOf}T00:00:00.000Z`);
  return (Date.parse(isoDay(now) + "T00:00:00.000Z") - then) / 86_400_000;
}
