import {
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { ChannelsService } from "./channels.service.js";

/**
 * Channel read-state (Phase 4.4). Marking a channel read advances the member's
 * read cursor so its unread badge clears. Same guard spine as the rest of the
 * trip API (`trip.view`, every member); the channel is checked to belong to the
 * trip in the service.
 */
@Controller("trips/:id/channels")
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post(":channelId/read")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  markRead(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("channelId") channelId: string,
  ): Promise<void> {
    return this.channels.markRead(ctx.trip.id, user.id, channelId);
  }
}
