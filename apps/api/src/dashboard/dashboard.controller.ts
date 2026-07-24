import { Controller, Get, UseGuards } from "@nestjs/common";
import type { TripDashboardView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * The per-trip cost dashboard (Phase 3.2). One read route, on the Phase-1.2
 * authorization spine: TripContextGuard resolves the trip + caller role (a
 * non-member gets a 404, existence not leaked), then PermissionGuard requires
 * `trip.view` — every member (including Guest) may see the cost picture.
 */
@Controller("trips/:id/dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** The trip's per-currency committed + projected cost picture (any member). */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  getDashboard(@TripCtx() ctx: TripContext): Promise<TripDashboardView> {
    return this.dashboard.getTripDashboard(ctx);
  }
}
