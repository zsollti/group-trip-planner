import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import type { RequestWithTripContext, TripContext } from "./trip-context.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the trip in the `:id` route param plus the caller's membership/role
 * **before any handler runs**, and attaches an immutable {@link TripContext} to
 * the request. Runs after {@link JwtAuthGuard}, so `request.user` is present.
 *
 * A caller who is not a member gets a **404, not a 403** (SRS Phase-1 decision
 * 4): outsiders must not be able to tell whether a trip exists. This minimal
 * is-a-member form is the seed of the full authorization guard built in Phase
 * 1.2 — the permission engine plugs into the same resolved context.
 */
@Injectable()
export class TripContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: User } & RequestWithTripContext>();

    // Express types params loosely under this intersection; a route param is
    // always a single string.
    const tripId = request.params.id as string | undefined;
    // A malformed id cannot be a real trip; return the same 404 rather than
    // letting a non-UUID reach Prisma (guards run before validation pipes).
    if (!tripId || !UUID_RE.test(tripId)) {
      throw new NotFoundException("Trip not found");
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId: request.user.id } },
    });
    // Existence is not confirmed to non-members: identical 404.
    if (!membership) throw new NotFoundException("Trip not found");

    const tripContext: TripContext = {
      trip,
      role: membership.role,
      membershipId: membership.id,
      muted: membership.muted,
    };
    request.tripContext = tripContext;
    return true;
  }
}
