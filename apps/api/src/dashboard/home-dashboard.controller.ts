import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { HomeDashboardView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { parseLimit } from "../common/query-params.js";
import { HomeDashboardService } from "./home-dashboard.service.js";

/**
 * The all-trips home dashboard (Phase 3.4). Only `JwtAuthGuard` — this is not
 * scoped to one trip, and the service inherently returns just the caller's own
 * trips (membership-scoped). Supports `?limit` / `?offset` offset pagination.
 */
@Controller("dashboard")
export class HomeDashboardController {
  constructor(private readonly home: HomeDashboardService) {}

  /** One page of the caller's trips with cost summary + pending-decision count. */
  @Get()
  @UseGuards(JwtAuthGuard)
  getHome(
    @CurrentUser() user: User,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<HomeDashboardView> {
    return this.home.getHomeDashboard(
      user.id,
      parseLimit(limit),
      parseLimit(offset),
    );
  }
}
