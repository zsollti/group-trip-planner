import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  CreateOptionInput,
  UpdateOptionInput,
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
 * Options within a category, scoped under a trip (Phase 2.2). Every route runs
 * TripContextGuard first (non-members get a 404 — existence not leaked), then
 * PermissionGuard: reading needs `trip.view` (any member); propose/edit/delete
 * need `option.propose` (Participant+, not Guest — proposing is allowed
 * unverified, so there is no VerifiedEmailGuard). The proposer-or-Organizer
 * ownership rule and the Active-trip/locked guards live in the service.
 */
@Controller("trips/:id/categories/:categoryId/options")
export class OptionsController {
  constructor(private readonly options: OptionsService) {}

  /** List a category's live options with public vote tallies (any member). */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  listOptions(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
  ): Promise<OptionView[]> {
    return this.options.listOptions(ctx, user.id, categoryId);
  }

  /** Propose an option (Participant+). */
  @Post()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("option.propose")
  proposeOption(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Body(new ZodValidationPipe(CreateOptionInput)) body: CreateOptionInput,
  ): Promise<OptionView> {
    return this.options.proposeOption(ctx, user, categoryId, body);
  }

  /** Edit an option (proposer or Organizer) — optimistic concurrency, 409. */
  @Patch(":optionId")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("option.propose")
  editOption(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
    @Body(new ZodValidationPipe(UpdateOptionInput)) body: UpdateOptionInput,
  ): Promise<OptionView> {
    return this.options.editOption(ctx, user, categoryId, optionId, body);
  }

  /** Soft-delete an option (proposer or Organizer). Replies 204. */
  @Delete(":optionId")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("option.propose")
  deleteOption(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("categoryId") categoryId: string,
    @Param("optionId") optionId: string,
  ): Promise<void> {
    return this.options.deleteOption(ctx, user, categoryId, optionId);
  }
}
