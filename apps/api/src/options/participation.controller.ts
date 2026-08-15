import { Controller, Delete, Param, Post, UseGuards } from "@nestjs/common";
import type { OptionView } from "@gtp/types";
import type { User } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { OptionsService } from "./options.service.js";

/**
 * Saying you are in for an option (post-launch, replacing the fixed headcount).
 *
 * The same guard spine as votes, and for the same reason: TripContextGuard
 * resolves the trip + role (a non-member gets a 404, never a 403 that confirms
 * the trip exists), then PermissionGuard enforces `vote.cast`. That permission
 * is reused rather than a new one invented — it already means "a member in good
 * standing may register an opinion on an option", which is exactly this, and a
 * second permission with an identical role set would be two names for one rule.
 *
 * **Only for yourself.** There is no `:userId` on either route by design. A
 * headcount stopped being a number somebody typed on behalf of others, and
 * adding a route to opt a third party in would put that back. An organizer who
 * needs to cover someone not on the app prices the option for the whole group.
 */
@Controller("trips/:id/categories/:categoryId/options/:optionId/participation")
export class ParticipationController {
  constructor(private readonly options: OptionsService) {}

  /** Join this option (Participant+). Idempotent; 400 if it is whole-group. */
  @Post()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("vote.cast")
  join(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
  ): Promise<OptionView> {
    return this.options.joinOption(ctx, user, categoryId, optionId);
  }

  /** Withdraw from this option (Participant+). Idempotent. */
  @Delete()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("vote.cast")
  leave(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
  ): Promise<OptionView> {
    return this.options.leaveOption(ctx, user, categoryId, optionId);
  }
}
