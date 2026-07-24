import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * The per-trip cost dashboard (Phase 3.2). Reuses the Phase-1.2 authorization
 * spine (TripContextGuard + PermissionGuard) and is a thin adapter over the pure
 * Phase-3.1 cost engine — no arithmetic of its own.
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, TripContextGuard, PermissionGuard],
})
export class DashboardModule {}
