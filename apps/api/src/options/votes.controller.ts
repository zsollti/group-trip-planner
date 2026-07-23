import {
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
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
 * Approval voting on an option (Phase 2.3, FR-22). Same guard spine as options —
 * TripContextGuard resolves the trip + role (non-members get a 404), then
 * PermissionGuard enforces `vote.cast` (Participant+, not Guest/Visitor). The
 * Active-trip freeze and idempotent upsert/delete live in the service. Both
 * routes return the option with its refreshed **public** tally so the client can
 * update in place. A member votes for many options in a category (approval
 * style); voting is advisory and never decides anything (only a lock does).
 */
@Controller("trips/:id/categories/:categoryId/options/:optionId/votes")
export class VotesController {
  constructor(private readonly options: OptionsService) {}

  /** Cast (or re-affirm) a vote for this option (Participant+). Idempotent. */
  @Post()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("vote.cast")
  castVote(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
  ): Promise<OptionView> {
    return this.options.castVote(ctx, user, categoryId, optionId);
  }

  /** Retract this member's vote for the option (Participant+). Idempotent. */
  @Delete()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("vote.cast")
  removeVote(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
  ): Promise<OptionView> {
    return this.options.removeVote(ctx, user, categoryId, optionId);
  }
}
