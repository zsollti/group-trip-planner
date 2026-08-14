import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";

/**
 * Planning categories (Phase 2.1). Reuses the Phase-1.2 authorization spine —
 * TripContextGuard resolves the trip + caller role, PermissionGuard enforces the
 * declared capability. CategoriesService is also used by TripsService to seed
 * the built-ins inside the trip-creation transaction, so it is exported.
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, TripContextGuard, PermissionGuard],
  exports: [CategoriesService],
})
export class CategoriesModule {}
