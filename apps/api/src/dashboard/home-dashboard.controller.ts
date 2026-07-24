import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { HomeDashboardView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { HomeDashboardService } from "./home-dashboard.service.js";

/** Parse a numeric query param; a missing or non-numeric value is `undefined`
 * (the service applies its defaults/clamps). */
function toInt(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

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
    return this.home.getHomeDashboard(user.id, toInt(limit), toInt(offset));
  }
}
