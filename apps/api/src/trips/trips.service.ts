import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { maxTripHorizonDays, planLockedDates } from "@gtp/types";
import type {
  CreateTripInput,
  TripDetail,
  TripPreview,
  TripSummary,
  UpdateTripInput,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { CategoriesService } from "../categories/categories.service.js";
import { ChannelsService } from "../chat/channels.service.js";
import {
  DATE_REJECTION_MESSAGE,
  OptionsService,
} from "../options/options.service.js";
import { ImageAttachmentService } from "../uploads/image-attachment.service.js";
import type { UploadedImageFile } from "../uploads/uploads.service.js";
import type { TripContext } from "./trip-context.js";
import { toTripDetail, toTripPreview, toTripSummary } from "./trip.mapper.js";

/** Fallback lifetime for a trip with no locked Dates yet: created + 1 year
 * (SRS §6). Dates write-back in Phase 2 replaces this with end_date + 1 month. */
function oneYearFromNow(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageAttachmentService,
  ) {}

  /**
   * Create a trip, the creator's Owner membership, the built-in categories,
   * **and the General chat channel in one transaction** — a trip must never exist
   * without its owner, its planning categories (Phase 2.1), or its General channel
   * (Phase 4.1). The caller is already known to be verified (route guard).
   *
   * Dates on the create form are optional (post-launch). When given they are
   * validated by the **same** `planLockedDates` rules a later lock would apply,
   * and seeded as an already-locked Dates option — so the trip's date columns
   * still have exactly one writer, and the group can unlock to reopen the
   * question like any other decision.
   */
  async createTrip(user: User, input: CreateTripInput): Promise<TripDetail> {
    const dates = this.planCreateDates(input);
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          destination: input.destination ?? null,
          defaultCurrency: input.defaultCurrency,
          budgetPerPerson: input.budgetPerPerson ?? null,
          startDate: dates?.startDate ?? null,
          endDate: dates?.endDate ?? null,
          expiresAt: dates?.expiresAt ?? oneYearFromNow(),
          ownerId: user.id,
        },
      });
      await tx.tripMembership.create({
        data: { tripId: created.id, userId: user.id, role: "OWNER" },
      });
      await CategoriesService.seedBuiltins(tx, created.id);
      await ChannelsService.createGeneral(tx, created.id);
      if (dates) {
        await OptionsService.seedLockedDates(
          tx,
          created.id,
          user.id,
          dates,
          created.defaultCurrency,
        );
      }
      return created;
    });

    // Freshly created: exactly one member (the owner).
    return toTripDetail({ ...trip, _count: { memberships: 1 } }, "OWNER");
  }

  /**
   * Validate optional create-form dates and derive the trip's columns from them,
   * or null when none were given.
   *
   * Runs the identical rule a Dates lock runs — no past start, nothing beyond the
   * planning horizon, expiry at end + 1 month — reusing `planLockedDates` and the
   * lock's own rejection messages. Nothing may enter through create that could
   * not have been locked afterwards; otherwise the create form becomes a way to
   * smuggle a trip into a state the rest of the app refuses to produce.
   *
   * The schema has already guaranteed both dates are present or both absent.
   */
  private planCreateDates(
    input: CreateTripInput,
  ): { startDate: Date; endDate: Date; expiresAt: Date } | null {
    if (!input.startDate || !input.endDate) return null;
    const plan = planLockedDates(
      input.startDate,
      input.endDate,
      Date.now(),
      maxTripHorizonDays(),
    );
    if (!plan.ok) {
      throw new BadRequestException(DATE_REJECTION_MESSAGE[plan.reason]);
    }
    return {
      startDate: new Date(plan.startDate),
      endDate: new Date(plan.endDate),
      expiresAt: new Date(plan.expiresAt),
    };
  }

  /** The caller's trips (any role), newest first. */
  async listMyTrips(userId: string): Promise<TripSummary[]> {
    const memberships = await this.prisma.tripMembership.findMany({
      where: { userId },
      include: {
        trip: { include: { _count: { select: { memberships: true } } } },
      },
      orderBy: { trip: { createdAt: "desc" } },
    });
    return memberships.map((m) => toTripSummary(m.trip, m.role));
  }

  /** Trip detail for a member — the trip-context is already resolved + authorized. */
  getTripDetail(ctx: TripContext): TripDetail {
    return toTripDetail(ctx.trip, ctx.role, ctx.muted);
  }

  /**
   * Edit trip details with optimistic concurrency (SRS §6). The write is
   * conditioned on the `version` the caller last saw: `updateMany` touches zero
   * rows if someone else edited in the meantime, which we surface as a 409 so
   * the front-end can prompt a reload. On success the version is bumped. The
   * caller's permission (Owner/Co-org) is already enforced by PermissionGuard;
   * their role comes from the resolved context, never re-queried.
   */
  async updateTrip(
    ctx: TripContext,
    input: UpdateTripInput,
  ): Promise<TripDetail> {
    const result = await this.prisma.trip.updateMany({
      where: { id: ctx.trip.id, version: input.version },
      data: {
        name: input.name,
        description: input.description ?? null,
        destination: input.destination ?? null,
        defaultCurrency: input.defaultCurrency,
        // A full-object replace like the fields above it: an omitted target has
        // been cleared, not left alone.
        budgetPerPerson: input.budgetPerPerson ?? null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        "This trip was changed since you opened it. Reload to see the latest.",
      );
    }

    const updated = await this.prisma.trip.findUniqueOrThrow({
      where: { id: ctx.trip.id },
      include: { _count: { select: { memberships: true } } },
    });
    return toTripDetail(updated, ctx.role, ctx.muted);
  }

  /**
   * Set or replace the trip's cover (Phase 6.2). The image goes through the
   * hardened Phase-6.1 pipeline first; only then is the row pointed at the new
   * URL and the object behind the old one dropped.
   *
   * No `version` check, unlike {@link updateTrip}: a cover is a single
   * last-write-wins field, and making an organizer reload because someone else
   * changed the trip's *name* would be friction with nothing behind it.
   */
  async setCover(
    ctx: TripContext,
    file: UploadedImageFile,
    userId: string,
  ): Promise<TripDetail> {
    const stored = await this.images.replace(
      file,
      userId,
      ctx.trip.coverImageUrl,
    );
    const updated = await this.prisma.trip.update({
      where: { id: ctx.trip.id },
      data: { coverImageUrl: stored.url },
      include: { _count: { select: { memberships: true } } },
    });
    return toTripDetail(updated, ctx.role, ctx.muted);
  }

  /** Clear the cover and delete the object it pointed at. */
  async removeCover(ctx: TripContext): Promise<TripDetail> {
    const updated = await this.prisma.trip.update({
      where: { id: ctx.trip.id },
      data: { coverImageUrl: null },
      include: { _count: { select: { memberships: true } } },
    });
    await this.images.discard(ctx.trip.coverImageUrl);
    return toTripDetail(updated, ctx.role, ctx.muted);
  }

  /**
   * Delete a trip (Owner only — enforced by PermissionGuard). The DB cascades
   * memberships (and, in later phases, all trip content). Returns nothing; the
   * controller replies 204.
   */
  async deleteTrip(ctx: TripContext): Promise<void> {
    await this.prisma.trip.delete({ where: { id: ctx.trip.id } });
  }

  /**
   * Public Visitor-scope preview (no auth). Returns only the four allowed
   * fields + member count; a missing trip is a plain 404.
   */
  async getPreview(tripId: string): Promise<TripPreview> {
    // Malformed id → same 404 (don't let a non-UUID reach Prisma).
    if (!UUID_RE.test(tripId)) throw new NotFoundException("Trip not found");
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    return toTripPreview(trip);
  }
}
