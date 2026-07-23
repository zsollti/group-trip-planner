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
  CreateTripInput,
  type TripDetail,
  type TripPreview,
  type TripSummary,
  UpdateTripInput,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import { TripsService } from "./trips.service.js";
import { TripContextGuard } from "./trip-context.guard.js";
import { TripCtx } from "./trip-context.decorator.js";
import type { TripContext } from "./trip-context.js";

@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /** Create a trip. Verified-email gated (SRS FR-7); creator becomes Owner. */
  @Post()
  @UseGuards(JwtAuthGuard, VerifiedEmailGuard)
  createTrip(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(CreateTripInput)) body: CreateTripInput,
  ): Promise<TripDetail> {
    return this.trips.createTrip(user, body);
  }

  /** The caller's trips (any role). */
  @Get()
  @UseGuards(JwtAuthGuard)
  listMyTrips(@CurrentUser() user: User): Promise<TripSummary[]> {
    return this.trips.listMyTrips(user.id);
  }

  /**
   * Public Visitor-scope preview — declared before the member route and behind
   * no auth guard. Returns only name/dates/destination/member-count.
   */
  @Get(":id/preview")
  getPreview(@Param("id") id: string): Promise<TripPreview> {
    return this.trips.getPreview(id);
  }

  /** Trip detail for a member. Non-members get a 404 (existence not leaked). */
  @Get(":id")
  @UseGuards(JwtAuthGuard, TripContextGuard)
  getTrip(@TripCtx() ctx: TripContext): TripDetail {
    return this.trips.getTripDetail(ctx);
  }

  /**
   * Edit trip details (Owner/Co-organizer). The guard chain resolves the trip +
   * caller's role (404 for non-members) then enforces `trip.edit`; the service
   * applies the optimistic-concurrency check on `version` (409 on conflict).
   */
  @Patch(":id")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.edit")
  updateTrip(
    @TripCtx() ctx: TripContext,
    @Body(new ZodValidationPipe(UpdateTripInput)) body: UpdateTripInput,
  ): Promise<TripDetail> {
    return this.trips.updateTrip(ctx, body);
  }

  /** Delete a trip (Owner only) — hard cascade. Replies 204. */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.delete")
  deleteTrip(@TripCtx() ctx: TripContext): Promise<void> {
    return this.trips.deleteTrip(ctx);
  }
}
