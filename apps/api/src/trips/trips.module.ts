import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripsController } from "./trips.controller.js";
import { TripsService } from "./trips.service.js";
import { TripContextGuard } from "./trip-context.guard.js";

/**
 * Trips & membership (Phase 1.1–1.2). PrismaModule is global; the JWT auth +
 * verified-email guards come from AuthModule's exports. TripContextGuard and
 * the PermissionGuard (Phase 1.2 authorization) are provided here so they can
 * be applied per-route via @UseGuards. The Reflector the PermissionGuard needs
 * is supplied by Nest core.
 */
@Module({
  // UploadsModule supplies the cover-image pipeline (Phase 6.2) and, with it,
  // the multer config the cover route's FileInterceptor needs.
  imports: [AuthModule, UploadsModule],
  controllers: [TripsController],
  providers: [TripsService, TripContextGuard, PermissionGuard],
})
export class TripsModule {}
