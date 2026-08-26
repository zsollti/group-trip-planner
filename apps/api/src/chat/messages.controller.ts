import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  MESSAGE_SEARCH_MAX_LENGTH,
  MESSAGE_SEARCH_MIN_LENGTH,
  type MessagePage,
  type MessageSearchView,
  type MessageView,
} from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import {
  parseCursor,
  parseLimit,
  requireIdParam,
} from "../common/query-params.js";
import { MessagesService } from "./messages.service.js";

/**
 * Cursor-paged channel history (Phase 4.2). The live stream flows over the
 * socket; this REST read backs the initial load and infinite-scroll "load older"
 * — and, in 4.4, the reconnect catch-up. Same guard spine as the rest of the
 * trip API: TripContextGuard resolves the trip + role (non-members get a 404),
 * PermissionGuard enforces `message.read` — every member except a Guest, who
 * post-launch has no chat at all. It was `trip.view`, which every member holds,
 * so gating only the *writes* would have left the whole transcript one GET
 * away from a role invited to look at the board. The channel is checked to
 * belong to the trip in the service.
 */
@Controller("trips/:id/channels/:channelId/messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  history(
    @TripCtx() ctx: TripContext,
    @Param("channelId") channelId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<MessagePage> {
    return this.messages.history(
      ctx.trip.id,
      channelId,
      parseCursor(cursor),
      parseLimit(limit),
    );
  }

  /** Reconnect catch-up: messages after the client's last-seen id (Phase 4.4). */
  @Get("since")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  since(
    @TripCtx() ctx: TripContext,
    @Param("channelId") channelId: string,
    @Query("after") after: string,
  ): Promise<MessageView[]> {
    // No anchor means the client has seen nothing yet — an empty catch-up, not
    // an error. A *malformed* anchor is refused rather than cast in the database.
    if (!after) return Promise.resolve([]);
    return this.messages.since(
      ctx.trip.id,
      channelId,
      requireIdParam(after, "after"),
    );
  }
}

/**
 * Searching a board's whole transcript (post-launch).
 *
 * Its own controller because it has its own path: a search is about the *trip*,
 * not about one channel, so it cannot hang off the channel-scoped routes above
 * — and the reader asking it usually cannot say which channel the answer is in,
 * which is the reason they are searching.
 *
 * Same guard spine and the same permission as reading history, because it is
 * reading history: anything this returns, a `GET .../messages` would have
 * returned to the same caller eventually.
 */
@Controller("trips/:id/messages")
export class MessageSearchController {
  constructor(private readonly messages: MessagesService) {}

  @Get("search")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("message.read")
  search(
    @TripCtx() ctx: TripContext,
    @Query("q") q?: string,
  ): Promise<MessageSearchView> {
    const term = (q ?? "").trim();
    // An empty box is not an error and must not be a query: matching everything
    // would hand back the board's whole transcript for a keystroke.
    if (term.length === 0) {
      return Promise.resolve({ messages: [], truncated: false });
    }
    if (term.length < MESSAGE_SEARCH_MIN_LENGTH) {
      return Promise.resolve({ messages: [], truncated: false });
    }
    if (term.length > MESSAGE_SEARCH_MAX_LENGTH) {
      throw new BadRequestException("That search is too long.");
    }
    return this.messages.search(ctx.trip.id, term);
  }
}
