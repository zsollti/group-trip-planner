import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { OptionsController } from "./options.controller.js";
import { OptionsService } from "./options.service.js";
import { VotesController } from "./votes.controller.js";

/**
 * Options (Phase 2.2). Reuses the Phase-1.2 authorization spine — TripContextGuard
 * resolves the trip + caller role, PermissionGuard enforces the declared
 * capability — and layers the proposer-or-Organizer, Active-trip, locked, and
 * optimistic-concurrency rules in the service. Phase 2.3 adds the VotesController
 * (approval voting) on the same service + guard spine.
 */
@Module({
  imports: [AuthModule],
  controllers: [OptionsController, VotesController],
  providers: [OptionsService, TripContextGuard, PermissionGuard],
})
export class OptionsModule {}
