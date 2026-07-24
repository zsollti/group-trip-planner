import { Injectable } from "@nestjs/common";
import { computeCostDashboard, type TripDashboardView } from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import {
  dashboardOptionInclude,
  toEngineOption,
  toTripDashboardView,
} from "./dashboard.mapper.js";

/**
 * Per-trip cost dashboard (Phase 3.2, SRS §6 / FR-26–27). A **thin adapter** over
 * the pure cost engine (Phase 3.1): it loads the trip's options in one eager
 * query, maps them to the engine's lean input, and formats the result. All the
 * arithmetic — headcount resolution, per-currency aggregation, committed vs.
 * projected, stale flags — lives in `@gtp/types/cost`, not here.
 *
 * **No N+1 (NFR-1):** exactly one query. The live member count and the trip's
 * `membershipChangedAt` are already on the request's {@link TripContext} (the
 * TripContextGuard eager-loads the trip + membership count), so the engine's two
 * scalar inputs cost nothing extra; the single `findMany` pulls every option with
 * its vote tally via a relation `_count` in the same statement.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getTripDashboard(ctx: TripContext): Promise<TripDashboardView> {
    const rows = await this.prisma.option.findMany({
      where: { deletedAt: null, category: { tripId: ctx.trip.id } },
      include: dashboardOptionInclude,
      orderBy: { createdAt: "asc" },
    });

    const memberCount = ctx.trip._count.memberships;
    const membershipChangedAt = ctx.trip.membershipChangedAt
      ? ctx.trip.membershipChangedAt.toISOString()
      : null;

    const result = computeCostDashboard(
      rows.map(toEngineOption),
      memberCount,
      membershipChangedAt,
    );

    return toTripDashboardView(ctx.trip, memberCount, rows, result, new Date());
  }
}
