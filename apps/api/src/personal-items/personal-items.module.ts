import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { UserThrottlerGuard } from "../common/user-throttler.guard.js";
import { PersonalItemsController } from "./personal-items.controller.js";
import { PersonalItemsService } from "./personal-items.service.js";

/**
 * Personal items (post-launch) — one member's private list on a trip.
 *
 * Rides the same Phase-1.2 authorization spine as every other trip-scoped
 * module: TripContextGuard resolves the trip and the caller's role (404 for a
 * non-member), PermissionGuard enforces the declared capability. The rule those
 * two cannot express — that one member's rows are not another's — lives in the
 * service, where every query is keyed on `{ tripId, ownerId }`.
 *
 * Notably thinner than `OptionsModule` on everything else: no realtime gateway
 * and no notifications. That is not an omission but the feature — nothing here
 * is news to anybody except the person who wrote it, so there is nothing to
 * broadcast and nobody to email.
 *
 * Nothing is exported either. A departing member's rows do have to go — that is
 * the one cascade Prisma cannot express, since leaving deletes a membership
 * rather than a user or a trip — but that delete lives beside the vote and
 * participant deletes it belongs with, in `MembersService.dropAnswers`, rather
 * than as a second statement of the same rule reached through this module.
 */
@Module({
  imports: [AuthModule],
  controllers: [PersonalItemsController],
  providers: [
    PersonalItemsService,
    TripContextGuard,
    PermissionGuard,
    UserThrottlerGuard,
  ],
})
export class PersonalItemsModule {}
