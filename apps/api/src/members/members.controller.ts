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
  ChangeMemberRoleInput,
  TransferOwnershipInput,
  TripMuteInput,
  type TripMembersView,
  type TripMemberView,
  type TripMuteView,
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
import { MembersService } from "./members.service.js";

/**
 * Membership management, scoped under a trip (Phase 1.4). Every route runs
 * TripContextGuard first (non-members get a 404 — existence not leaked), then
 * PermissionGuard enforces the coarse capability; the service layers the
 * strictly-lower-role rule on top. Reading the member list needs only
 * `trip.view` (any member); the mutations need `member.manage`, except transfer
 * (`trip.transferOwnership`, Owner) and leave (`trip.leave`, Owner excluded by
 * the matrix — FR-12).
 */
@Controller("trips/:id/members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** The member list + block list (any member). */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  listMembers(@TripCtx() ctx: TripContext): Promise<TripMembersView> {
    return this.members.listMembers(ctx);
  }

  /**
   * Mute or unmute **this trip's notification email** for the caller (Phase
   * 5.3). Declared before the `:userId` routes so the literal path wins the
   * match.
   *
   * Gated on `trip.view`, not `member.manage`: this edits the caller's own
   * membership row and nobody else's, so every member — Guests included — may
   * silence a trip they are in. The in-app bell is untouched.
   */
  @Post("mute")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  setMute(
    @TripCtx() ctx: TripContext,
    @Body(new ZodValidationPipe(TripMuteInput)) body: TripMuteInput,
  ): Promise<TripMuteView> {
    return this.members.setMute(ctx, body.muted);
  }

  /** Change a member's role (Owner/Co-organizer, strictly-lower). */
  @Patch(":userId")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("member.manage")
  changeRole(
    @TripCtx() ctx: TripContext,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(ChangeMemberRoleInput))
    body: ChangeMemberRoleInput,
  ): Promise<TripMemberView> {
    return this.members.changeRole(ctx, userId, body.role);
  }

  /** Kick a member — soft removal (may rejoin via a live link). Replies 204. */
  @Delete(":userId")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("member.manage")
  kick(
    @TripCtx() ctx: TripContext,
    @Param("userId") userId: string,
  ): Promise<void> {
    return this.members.kick(ctx, userId);
  }

  /** Block a member — ejection + hard bar. Replies 204. */
  @Post(":userId/block")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("member.manage")
  block(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("userId") userId: string,
  ): Promise<void> {
    return this.members.block(ctx, user, userId);
  }

  /** Unblock a user — removes the bar so they can rejoin. Replies 204. */
  @Delete(":userId/block")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("member.manage")
  unblock(
    @TripCtx() ctx: TripContext,
    @Param("userId") userId: string,
  ): Promise<void> {
    return this.members.unblock(ctx, userId);
  }

  /** Transfer ownership to another member (Owner only, FR-12). Replies 204. */
  @Post("transfer")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.transferOwnership")
  transfer(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(TransferOwnershipInput))
    body: TransferOwnershipInput,
  ): Promise<void> {
    return this.members.transferOwnership(ctx, user, body.userId);
  }

  /** Leave the trip (Owner must transfer/delete first — matrix-enforced). 204. */
  @Post("leave")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.leave")
  leave(@TripCtx() ctx: TripContext, @CurrentUser() user: User): Promise<void> {
    return this.members.leave(ctx, user);
  }
}
