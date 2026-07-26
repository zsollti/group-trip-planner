import { Injectable } from "@nestjs/common";
import type { ActivityPage } from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toActivityEvent } from "./activity.mapper.js";

/** Default and maximum page size for the feed. */
const DEFAULT_PAGE = 25;
const MAX_PAGE = 100;

/**
 * The trip activity feed (Phase 5.4, FR-33) — read-only by construction.
 *
 * There is no write path here: every event is written by the action that caused
 * it, inside that action's transaction (see `activity/audit.ts`). That is what
 * makes the feed a faithful mirror of the log rather than a parallel account of
 * events that could drift from it.
 *
 * Scoping is the caller's trip context, which the guard resolved from a
 * membership row — so a non-member never reaches this service at all.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the trip's activity, newest first.
   *
   * Ordered by `(createdAt, id)` and paged with Prisma's `cursor`, so a burst of
   * events sharing a timestamp still pages without skipping or repeating a row —
   * the id is the tiebreak that makes the order total.
   */
  async list(
    ctx: TripContext,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<ActivityPage> {
    const take = Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    const rows = await this.prisma.auditEvent.findMany({
      where: { tripId: ctx.trip.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1, // one extra row tells us whether an older page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        actor: { select: { displayName: true, anonymizedAt: true } },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      events: page.map(toActivityEvent),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
