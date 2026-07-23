import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

/**
 * Membership management (Phase 1.4). Reuses the Phase-1.2 authorization spine —
 * TripContextGuard resolves the trip + caller role, PermissionGuard enforces the
 * declared capability — and adds the strictly-lower-role rules in the service.
 */
@Module({
  imports: [AuthModule],
  controllers: [MembersController],
  providers: [MembersService, TripContextGuard, PermissionGuard],
})
export class MembersModule {}
