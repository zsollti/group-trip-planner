import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { ActivityController } from "./activity.controller.js";
import { ActivityService } from "./activity.service.js";

/**
 * The trip activity feed (Phase 5.4) — the **read** side of the audit log. The
 * write side deliberately lives nowhere near here: each action writes its own
 * event inside its own transaction, using the shared builders in `audit.ts`, so
 * this module owns no path that could record something that did not happen.
 *
 * Same authorization spine as MembersModule: TripContextGuard + PermissionGuard.
 */
@Module({
  imports: [AuthModule],
  controllers: [ActivityController],
  providers: [ActivityService, TripContextGuard, PermissionGuard],
})
export class ActivityModule {}
