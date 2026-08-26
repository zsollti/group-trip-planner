import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  CreateTripInput,
  type TripDetail,
  type TripPreview,
  type TripSummary,
  UpdateTripInput,
} from "@gtp/types";
import type { User } from "@prisma/client";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { UserThrottlerGuard } from "../common/user-throttler.guard.js";
import { TRIP_CREATE_THROTTLE } from "../common/throttle-policy.js";
import { PerUserThrottle } from "../common/per-user-throttle.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { PermissionGuard } from "../authz/permission.guard.js";
import { RequirePermission } from "../authz/require-permission.decorator.js";
import type { UploadedImageFile } from "../uploads/uploads.service.js";
import { TripsService } from "./trips.service.js";
import { TripContextGuard } from "./trip-context.guard.js";
import { TripCtx } from "./trip-context.decorator.js";
import type { TripContext } from "./trip-context.js";

@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /**
   * Create a trip. Verified-email gated (SRS FR-7); creator becomes Owner.
   * Per-user rate limit (7.1): each call seeds categories and a chat channel,
   * so a loop on this route writes far more than one row.
   */
  @Post()
  @UseGuards(JwtAuthGuard, VerifiedEmailGuard, UserThrottlerGuard)
  @PerUserThrottle(TRIP_CREATE_THROTTLE)
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

  /**
   * Set or replace the trip's cover image (Phase 6.2, organizers).
   *
   * Multipart in one step rather than "upload, then PATCH the URL back": a
   * client that could name the cover URL could point it at any address on the
   * internet, turning a trip page into someone else's tracking pixel. Here the
   * only reachable URL is one the Phase-6.1 pipeline just minted.
   */
  @Post(":id/cover")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.edit")
  @UseInterceptors(FileInterceptor("file"))
  uploadCover(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<TripDetail> {
    if (!file) {
      throw new BadRequestException("No file was uploaded (field name: file).");
    }
    return this.trips.setCover(ctx, file, user.id);
  }

  /** Remove the cover, deleting the stored object with it. */
  @Delete(":id/cover")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.edit")
  removeCover(@TripCtx() ctx: TripContext): Promise<TripDetail> {
    return this.trips.removeCover(ctx);
  }

  /**
   * Set or replace the picture the board's chat wears (post-launch, organizers).
   *
   * Multipart in one step for the same reason the cover is: a client that could
   * name the image's URL could point it at any address on the internet, and the
   * chat dock renders this picture on every page.
   *
   * Gated `trip.edit` — the owner's call. The picture is how the board appears
   * to everyone on it, so it belongs with the things organizers decide about
   * the trip rather than with the things a member decides about their own view.
   */
  @Post(":id/chat-image")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.edit")
  @UseInterceptors(FileInterceptor("file"))
  uploadChatImage(
    @TripCtx() ctx: TripContext,
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<TripDetail> {
    if (!file) {
      throw new BadRequestException("No file was uploaded (field name: file).");
    }
    return this.trips.setChatImage(ctx, file, user.id);
  }

  /** Remove the chat picture, deleting the stored object with it. */
  @Delete(":id/chat-image")
  @UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)
  @RequirePermission("trip.edit")
  removeChatImage(@TripCtx() ctx: TripContext): Promise<TripDetail> {
    return this.trips.removeChatImage(ctx);
  }
}
