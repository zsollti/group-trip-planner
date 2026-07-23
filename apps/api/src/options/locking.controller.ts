import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import {
  LockOptionInput,
  UnlockOptionInput,
  type OptionView,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { OptionsService } from "./options.service.js";

/**
 * Locking an option = recording the group's decision (Phase 2.4, FR-24) — the
 * app's headline concurrency surface. Same guard spine as the rest of options:
 * TripContextGuard (non-members 404), then PermissionGuard on `decision.lock`
 * (Organizers only — Owner/Co-organizer). The Active-trip freeze, the
 * category-aware atomic compare-and-set, the single-choice sibling unlock, and
 * the audit writes all live in the service. Both routes return the option's
 * refreshed view; a rejected lock is a 409 whose message tells the client to
 * reload and see the current state (locking is confirmed, never optimistic).
 */
@Controller("trips/:id/categories/:categoryId/options/:optionId")
export class LockingController {
  constructor(private readonly options: OptionsService) {}

  /** Lock an option (Organizers). 409 if a concurrent locker won the race. */
  @Post("lock")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("decision.lock")
  lockOption(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
    @Body(new ZodValidationPipe(LockOptionInput)) body: LockOptionInput,
  ): Promise<OptionView> {
    return this.options.lockOption(ctx, user, categoryId, optionId, body);
  }

  /** Unlock a locked option (Organizers). 409 if it changed since. */
  @Post("unlock")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("decision.lock")
  unlockOption(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
    @Body(new ZodValidationPipe(UnlockOptionInput)) body: UnlockOptionInput,
  ): Promise<OptionView> {
    return this.options.unlockOption(ctx, user, categoryId, optionId, body);
  }
}
