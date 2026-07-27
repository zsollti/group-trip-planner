import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EmailModule } from "../email/email.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { InvitesController } from "./invites.controller.js";
import { JoinController } from "./join.controller.js";
import { InvitesService } from "./invites.service.js";
import { UserThrottlerGuard } from "../common/user-throttler.guard.js";

/**
 * Invite links (Phase 1.3). Reuses the auth + verified-email guards from
 * AuthModule and the trip-context/permission guards (provided here for per-route
 * @UseGuards, mirroring TripsModule). EmailModule supplies the personal-invite
 * delivery. PrismaModule is global.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [InvitesController, JoinController],
  providers: [
    InvitesService,
    TripContextGuard,
    PermissionGuard,
    UserThrottlerGuard,
  ],
})
export class InvitesModule {}
