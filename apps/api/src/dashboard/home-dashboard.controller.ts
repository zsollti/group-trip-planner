import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { ReorderTripsInput, type HomeDashboardView } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { parseLimit } from "../common/query-params.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { HomeDashboardService } from "./home-dashboard.service.js";

/**
 * The all-trips home dashboard (Phase 3.4). Only `JwtAuthGuard` — this is not
 * scoped to one trip, and the service inherently returns just the caller's own
 * trips (membership-scoped). Supports `?limit` / `?offset` offset pagination.
 */
@Controller("dashboard")
export class HomeDashboardController {
  constructor(private readonly home: HomeDashboardService) {}

  /** One page of the caller's trips with cost summary + pending-decision count. */
  @Get()
  @UseGuards(JwtAuthGuard)
  getHome(
    @CurrentUser() user: User,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<HomeDashboardView> {
    return this.home.getHomeDashboard(
      user.id,
      parseLimit(limit),
      parseLimit(offset),
    );
  }

  /**
   * Rearrange the caller's own overview.
   *
   * No trip guard, and deliberately: this is not an action *on* a trip, it is
   * an edit to the caller's own memberships, so the only authority needed is a
   * session. The service scopes every write by `user.id` — an id belonging to
   * someone else's trip matches no row of the caller's and changes nothing.
   *
   * Answers 204: the client already has the order it just sent, and returning
   * the page would make a drag cost a full dashboard recomputation.
   */
  @Patch("order")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async reorder(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(ReorderTripsInput)) body: ReorderTripsInput,
  ): Promise<void> {
    await this.home.reorderTrips(user.id, body.tripIds);
  }
}
