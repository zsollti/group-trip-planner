import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { StartDiscussionInput, type ChannelView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { ChannelsService } from "./channels.service.js";

/**
 * Channel management (Phase 4.4 read-state + 4.5 on-demand category channels).
 * Marking a channel read advances the member's read cursor so its unread badge
 * clears; starting a discussion materializes a category's channel on demand.
 * Same guard spine as the rest of the trip API; the channel/category is checked
 * to belong to the trip in the service.
 */
@Controller("trips/:id/channels")
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  /**
   * Start a discussion on a category (Phase 4.5, FR-29) — creates its channel on
   * demand, idempotently. Gated `message.post`: starting a discussion is a chat
   * action rather than an organizer one, so every member who has chat at all may
   * do it — which post-launch means everyone but a Guest.
   */
  @Post()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.post")
  startDiscussion(
    @TripCtx() ctx: TripContext,
    @Body(new ZodValidationPipe(StartDiscussionInput))
    body: StartDiscussionInput,
  ): Promise<ChannelView> {
    return this.channels.startCategoryDiscussion(ctx.trip.id, body.categoryId);
  }

  // A read cursor is a chat fact, so it is gated with the rest of chat rather
  // than on `trip.view` — a role with no transcript has nothing to mark read.
  @Post(":channelId/read")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  markRead(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Param("channelId") channelId: string,
  ): Promise<void> {
    return this.channels.markRead(ctx.trip.id, user.id, channelId);
  }
}
