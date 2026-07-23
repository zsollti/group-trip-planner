import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  CreateInviteInput,
  type InviteLinkView,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { InvitesService } from "./invites.service.js";

/**
 * Invite-link management, scoped under a trip (Phase 1.3). Every route runs
 * TripContextGuard first (non-members get a 404, existence not leaked) then
 * PermissionGuard for `invite.create` (Owner/Co-organizer). Creation is
 * additionally verified-email gated — but **after** the context/permission
 * guards, so a non-member still gets a 404 rather than a verify-your-email 403.
 */
@Controller("trips/:id/invites")
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Create a global or personal invite link. */
  @Post()
  @UseGuards(
    JwtAuthGuard,
    TripContextGuard,
    PermissionGuard,
    VerifiedEmailGuard,
  )
  @RequirePermission("invite.create")
  createInvite(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(CreateInviteInput)) body: CreateInviteInput,
  ): Promise<InviteLinkView> {
    return this.invites.createInvite(ctx, user, body);
  }

  /** List this trip's invite links (management view). */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("invite.create")
  listInvites(@TripCtx() ctx: TripContext): Promise<InviteLinkView[]> {
    return this.invites.listInvites(ctx);
  }

  /** Disable a link (soft — existing members retained). Returns the updated link. */
  @Delete(":inviteId")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("invite.create")
  disableInvite(
    @TripCtx() ctx: TripContext,
    @Param("inviteId") inviteId: string,
  ): Promise<InviteLinkView> {
    return this.invites.disableInvite(ctx, inviteId);
  }
}
