import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { HomeDashboardController } from "./home-dashboard.controller.js";
import { HomeDashboardService } from "./home-dashboard.service.js";

/**
 * The cost dashboards (Phase 3.2 + 3.4). The per-trip `GET /trips/:id/dashboard`
 * reuses the Phase-1.2 authorization spine (TripContextGuard + PermissionGuard);
 * the all-trips home `GET /dashboard` is membership-scoped under JwtAuthGuard.
 * Both are thin adapters over the pure Phase-3.1 cost engine.
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController, HomeDashboardController],
  providers: [
    DashboardService,
    HomeDashboardService,
    TripContextGuard,
    PermissionGuard,
  ],
})
export class DashboardModule {}
