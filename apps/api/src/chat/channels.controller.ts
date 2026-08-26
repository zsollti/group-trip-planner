import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import {
  ChatMuteInput,
  StartDiscussionInput,
  type ChannelView,
  type ChatMuteView,
} from "@gtp/types";
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

/**
 * Silencing a board's chat for the member asking (post-launch).
 *
 * Its own controller because it is its own noun: the mute belongs to the
 * reader's membership of the trip, not to a channel, and hanging it off
 * `trips/:id/channels` would have implied a per-channel setting the owner
 * deliberately did not ask for — the whole board goes quiet or none of it does.
 *
 * Gated `message.read` rather than on membership alone. A role with no
 * transcript has no badges and no mention toasts, so there is nothing for it to
 * silence; post-launch that means a Guest, who is refused here exactly as they
 * are refused the transcript itself.
 *
 * Always about the caller. There is no user id in the path or the body, so
 * there is no shape in which one member can quiet another member's app.
 */
@Controller("trips/:id/chat-mute")
export class ChatMuteController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  get(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
  ): Promise<ChatMuteView> {
    return this.channels.getMute(ctx.trip.id, user.id);
  }

  /**
   * Set it, or lift it with a null duration.
   *
   * `PUT` because it is the whole of the setting every time: the body says what
   * the mute should now be, not how to adjust what it was, so sending the same
   * request twice leaves the same state.
   */
  @Put()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  set(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(ChatMuteInput)) body: ChatMuteInput,
  ): Promise<ChatMuteView> {
    return this.channels.setMute(ctx.trip.id, user.id, body.duration);
  }
}
