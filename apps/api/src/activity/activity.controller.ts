import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { ActivityPage } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripContextGuard } from "../trips/trip-context.guard.js";
import { TripCtx } from "../trips/trip-context.decorator.js";
import type { TripContext } from "../trips/trip-context.js";
import { ActivityService } from "./activity.service.js";

/** Parse a numeric query param; missing/non-numeric falls back to the default. */
function toInt(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * The trip activity feed (Phase 5.4). Member-scoped through the usual spine:
 * TripContextGuard resolves membership (a non-member gets 404 — existence is not
 * leaked), then `trip.view` admits **any** member including Guests. The log
 * records what the trip already sees happening on the board, so there is nothing
 * here a member could not observe by watching; the organizer-only actions it
 * reports are precisely the ones the group should be able to audit.
 */
@Controller("trips/:id/activity")
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** One page of the trip's activity, newest first. */
  @Get()
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.view")
  list(
    @TripCtx() ctx: TripContext,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<ActivityPage> {
    return this.activity.list(ctx, cursor, toInt(limit));
  }
}
