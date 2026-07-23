import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TripsController } from "./trips.controller.js";
import { TripsService } from "./trips.service.js";
import { TripContextGuard } from "./trip-context.guard.js";

/**
 * Trips & membership (Phase 1.1). PrismaModule is global; the JWT auth +
 * verified-email guards come from AuthModule's exports. TripContextGuard is
 * provided here so it can be applied per-route via @UseGuards.
 */
@Module({
  imports: [AuthModule],
  controllers: [TripsController],
  providers: [TripsService, TripContextGuard],
})
export class TripsModule {}
