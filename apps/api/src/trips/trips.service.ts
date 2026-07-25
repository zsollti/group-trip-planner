import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a trip, the creator's Owner membership, the five built-in categories,
   * **and the General chat channel in one transaction** — a trip must never exist
   * without its owner, its planning categories (Phase 2.1), or its General channel
   * (Phase 4.1). The caller is already known to be verified (route guard).
   */
  async createTrip(user: User, input: CreateTripInput): Promise<TripDetail> {
    const trip = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          destination: input.destination ?? null,
          defaultCurrency: input.defaultCurrency,
          expiresAt: oneYearFromNow(),
          ownerId: user.id,
        },
      });
      await tx.tripMembership.create({
        data: { tripId: created.id, userId: user.id, role: "OWNER" },
      });
      await CategoriesService.seedBuiltins(tx, created.id);
      await ChannelsService.createGeneral(tx, created.id);
      return created;
    });

    // Freshly created: exactly one member (the owner).
    return toTripDetail({ ...trip, _count: { memberships: 1 } }, "OWNER");
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
    return toTripDetail(ctx.trip, ctx.role);
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
    return toTripDetail(updated, ctx.role);
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
