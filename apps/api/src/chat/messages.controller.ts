import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type { MessagePage, MessageView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { MessagesService } from "./messages.service.js";

/**
 * Cursor-paged channel history (Phase 4.2). The live stream flows over the
 * socket; this REST read backs the initial load and infinite-scroll "load older"
 * — and, in 4.4, the reconnect catch-up. Same guard spine as the rest of the
 * trip API: TripContextGuard resolves the trip + role (non-members get a 404),
 * PermissionGuard enforces `trip.view` (every member). The channel is checked to
 * belong to the trip in the service.
 */
@Controller("trips/:id/channels/:channelId/messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  history(
    @TripCtx() ctx: TripContext,
    @Param("channelId") channelId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<MessagePage> {
    const parsedLimit = limit ? Number(limit) : undefined;
    const safeLimit =
      parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    return this.messages.history(ctx.trip.id, channelId, cursor, safeLimit);
  }

  /** Reconnect catch-up: messages after the client's last-seen id (Phase 4.4). */
  @Get("since")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  since(
    @TripCtx() ctx: TripContext,
    @Param("channelId") channelId: string,
    @Query("after") after: string,
  ): Promise<MessageView[]> {
    if (!after) return Promise.resolve([]);
    return this.messages.since(ctx.trip.id, channelId, after);
  }
}
