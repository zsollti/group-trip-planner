import { Injectable, NotFoundException } from "@nestjs/common";
import type { User } from "@prisma/client";
import type {
  CreateTripInput,
  TripDetail,
  TripPreview,
  TripSummary,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
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
   * Create a trip and the creator's Owner membership **in one transaction** —
   * a trip must never exist without its owner. The caller is already known to
   * be verified (route guard).
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
