import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  CreateTripInput,
  type TripDetail,
  type TripPreview,
  type TripSummary,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
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
}
