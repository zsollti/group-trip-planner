import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Trip expiry job (Phase 2.5, FR-9). Persists the Active → History transition
 * for every trip past its `expiresAt`, so lists, dashboards, and notifications
 * can query the `status` column directly. This is **belt-and-suspenders**: the
 * planning-mutation guard already treats `now > expiresAt` as frozen at read
 * time (decision 4), so correctness never depends on this job firing — it only
 * keeps the persisted status current.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Flip expired Active trips to History; returns how many moved. */
  async expireTrips(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.trip.updateMany({
      where: { status: "ACTIVE", expiresAt: { lt: now } },
      data: { status: "HISTORY" },
    });
    if (result.count > 0) {
      this.logger.log(`Moved ${result.count} expired trip(s) to History.`);
    }
    return result.count;
  }

  /** Run hourly — granular enough for a day-scale expiry, cheap enough to spam. */
  @Cron(CronExpression.EVERY_HOUR)
  handleCron(): Promise<number> {
    return this.expireTrips();
  }
}
