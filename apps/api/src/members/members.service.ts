import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import {
  canActOn,
  canAssignRole,
  type AssignableRole,
  type TripMembersView,
  type TripMemberView,
  type TripMuteView,
} from "@gtp/types";
import { memberAudit } from "../activity/audit.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toTripBlockView, toTripMemberView } from "./member.mapper.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Membership management (Phase 1.4, SRS §3 + FR-12/17). Every mutation resolves
 * the **target's** role fresh from the DB — never from the client — and gates it
 * through the pure `canActOn` / `canAssignRole` rules from the permission engine.
 * The actor's own capability (`member.manage`, `trip.transferOwnership`,
 * `trip.leave`) is already enforced by the route's PermissionGuard; here we
 * enforce the orthogonal **strictly-lower-role** rule that stops a Co-organizer
 * from touching the Owner or a peer, and the FR-12 owner-must-transfer rule.
 */
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The trip's members (owner first by tenure) plus its block list. */
  async listMembers(ctx: TripContext): Promise<TripMembersView> {
    const [memberships, blocks] = await Promise.all([
      this.prisma.tripMembership.findMany({
        where: { tripId: ctx.trip.id },
        include: { user: { select: { displayName: true, avatarUrl: true } } },
        orderBy: { joinedAt: "asc" },
      }),
      this.prisma.tripBlock.findMany({
        where: { tripId: ctx.trip.id },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      members: memberships.map((m) => toTripMemberView(m, ctx.trip.ownerId)),
      blocked: blocks.map(toTripBlockView),
    };
  }

  /**
   * Load a target's membership, scoped to this trip. A malformed id or a user
   * who is not a member of *this* trip is an identical 404 — no cross-trip
   * probing, no existence leak.
   */
  private async requireTargetMembership(
    ctx: TripContext,
    targetUserId: string,
  ) {
    if (!UUID_RE.test(targetUserId)) {
      throw new NotFoundException("Member not found");
    }
    const membership = await this.prisma.tripMembership.findUnique({
      where: {
        tripId_userId: { tripId: ctx.trip.id, userId: targetUserId },
      },
      include: {
        user: {
          select: { displayName: true, emailVerified: true, avatarUrl: true },
        },
      },
    });
    if (!membership) throw new NotFoundException("Member not found");
    return membership;
  }

  /**
   * Change a member's role. Gated by *both* halves of the strictly-lower rule:
   * the actor must outrank the target's current role (`canActOn`) **and** the
   * role being granted (`canAssignRole`) — so a Co-organizer can never mint a
   * peer, and OWNER is never assignable here (that is a transfer). Promotion to
   * Co-organizer additionally requires the target to have a verified email (the
   * §3 promotion gate).
   */
  async changeRole(
    ctx: TripContext,
    actor: User,
    targetUserId: string,
    newRole: AssignableRole,
  ): Promise<TripMemberView> {
    const target = await this.requireTargetMembership(ctx, targetUserId);

    if (!canActOn(ctx.role, target.role)) {
      throw new ForbiddenException(
        "You can only manage members below your own role.",
      );
    }
    if (!canAssignRole(ctx.role, newRole)) {
      throw new ForbiddenException(
        "You can only assign a role below your own.",
      );
    }
    if (newRole === "CO_ORGANIZER" && !target.user.emailVerified) {
      throw new ForbiddenException(
        "That member must verify their email before becoming a co-organizer.",
      );
    }
    if (target.role === newRole) {
      // No-op change: return the current view without a write — and without an
      // audit row, so the feed never reports a change that did not happen.
      return toTripMemberView(target, ctx.trip.ownerId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tripMembership.update({
        where: { id: target.id },
        data: { role: newRole },
        include: { user: { select: { displayName: true, avatarUrl: true } } },
      });
      await tx.auditEvent.create({
        data: memberAudit(
          ctx.trip.id,
          actor.id,
          "MEMBER_ROLE_CHANGED",
          targetUserId,
          {
            targetName: target.user.displayName,
            fromRole: target.role,
            toRole: newRole,
          },
        ),
      });
      return row;
    });
    return toTripMemberView(updated, ctx.trip.ownerId);
  }

  /**
   * Kick a member — a **soft** removal (SRS FR-17): the membership row is
   * deleted, but no block is written, so they may rejoin through a live global
   * link. Strictly-lower-role enforced.
   */
  async kick(
    ctx: TripContext,
    actor: User,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.requireTargetMembership(ctx, targetUserId);
    if (!canActOn(ctx.role, target.role)) {
      throw new ForbiddenException(
        "You can only remove members below your own role.",
      );
    }
    await this.prisma.$transaction([
      this.prisma.tripMembership.delete({ where: { id: target.id } }),
      this.dropParticipation(ctx.trip.id, target.userId),
      this.prisma.auditEvent.create({
        data: memberAudit(
          ctx.trip.id,
          actor.id,
          "MEMBER_KICKED",
          targetUserId,
          { targetName: target.user.displayName },
        ),
      }),
    ]);
  }

  /**
   * Block a member — **ejection + a hard bar** (SRS FR-17). Deletes the
   * membership *and* writes a `TripBlock` in one transaction, so the bar
   * survives the ejection and no live link can let them back in (the join path
   * checks TripBlock). Strictly-lower-role enforced.
   */
  async block(
    ctx: TripContext,
    actor: User,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.requireTargetMembership(ctx, targetUserId);
    if (!canActOn(ctx.role, target.role)) {
      throw new ForbiddenException(
        "You can only block members below your own role.",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.tripMembership.delete({ where: { id: target.id } });
      await tx.tripBlock.upsert({
        where: {
          tripId_userId: { tripId: ctx.trip.id, userId: targetUserId },
        },
        create: {
          tripId: ctx.trip.id,
          userId: targetUserId,
          blockedById: actor.id,
        },
        update: {}, // already blocked → idempotent
      });
      // Ejected is ejected: their opt-ins go with the membership, exactly as on
      // a kick or a voluntary leave. Missing this would leave a blocked person
      // still counted in — and paying for — options on a trip they cannot open.
      await tx.optionParticipant.deleteMany({
        where: {
          userId: targetUserId,
          option: { category: { tripId: ctx.trip.id } },
        },
      });
      await tx.auditEvent.create({
        data: memberAudit(
          ctx.trip.id,
          actor.id,
          "MEMBER_BLOCKED",
          targetUserId,
          { targetName: target.user.displayName },
        ),
      });
    });
  }

  /**
   * Unblock a user (SRS FR-17) — deletes the `TripBlock`, letting them rejoin
   * via a link again. A blocked user has no membership/role, so only the actor's
   * `member.manage` capability (already checked by the guard) is required;
   * removing a nonexistent block is idempotent (still 204).
   */
  async unblock(
    ctx: TripContext,
    actor: User,
    targetUserId: string,
  ): Promise<void> {
    if (!UUID_RE.test(targetUserId)) {
      throw new NotFoundException("Member not found");
    }
    // Read the block first: its name snapshot is the only record of who this
    // was once the row is gone, and it tells us whether anything was undone.
    const block = await this.prisma.tripBlock.findUnique({
      where: { tripId_userId: { tripId: ctx.trip.id, userId: targetUserId } },
      include: { user: { select: { displayName: true } } },
    });
    // Removing a nonexistent block stays idempotent (204) — and writes no audit
    // row, so the feed does not report an unblock that undid nothing.
    if (!block) return;

    await this.prisma.$transaction([
      this.prisma.tripBlock.deleteMany({
        where: { tripId: ctx.trip.id, userId: targetUserId },
      }),
      this.prisma.auditEvent.create({
        data: memberAudit(
          ctx.trip.id,
          actor.id,
          "MEMBER_UNBLOCKED",
          targetUserId,
          { targetName: block.user.displayName },
        ),
      }),
    ]);
  }

  /**
   * Leave a trip (SRS FR-12). The Owner is barred by the permission matrix
   * (`trip.leave` excludes OWNER → PermissionGuard 403 before this runs), so a
   * departing owner must transfer or delete first. Everyone else simply drops
   * their membership.
   */
  async leave(ctx: TripContext, actor: User): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tripMembership.delete({
        where: {
          tripId_userId: { tripId: ctx.trip.id, userId: actor.id },
        },
      }),
      this.dropParticipation(ctx.trip.id, actor.id),
      // A departure is audited for the same reason a kick is: without it the
      // feed shows removals but not exits, and the trip is left wondering where
      // someone went. Actor and target are the same person here.
      this.prisma.auditEvent.create({
        data: memberAudit(ctx.trip.id, actor.id, "MEMBER_LEFT", actor.id, {
          targetName: actor.displayName,
        }),
      }),
    ]);
  }

  /**
   * Drop everything someone leaving the trip had opted in to.
   *
   * This is what lets the participants model claim it cannot go stale, and it
   * has to be an actual write — the `option_participants` foreign key cascades
   * from the **user**, not from the membership, so deleting a membership row
   * alone would leave a departed person counted in every option they had joined
   * and quietly inflating its cost.
   *
   * It replaces `touchMembership`, which stamped `Trip.membershipChangedAt` so
   * that a fixed headcount confirmed earlier could be flagged stale. There is no
   * fixed headcount and no staleness now, so the stamp had nothing left to date
   * and the column went with it.
   *
   * Scoped through the option's category to this trip: the same person may be
   * on other trips, and leaving one says nothing about those.
   */
  private dropParticipation(tripId: string, userId: string) {
    return this.prisma.optionParticipant.deleteMany({
      where: { userId, option: { category: { tripId } } },
    });
  }

  /**
   * Transfer ownership to an existing member (Owner only — SRS FR-12). In one
   * transaction the target is promoted to OWNER, the outgoing owner is demoted
   * to Co-organizer, and the trip's denormalized `ownerId` is repointed (the
   * `version` is bumped so an open editor reloads). The target must be a member
   * with a verified email (the promotion gate for Owner).
   */
  async transferOwnership(
    ctx: TripContext,
    actor: User,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId === actor.id) {
      throw new BadRequestException("You already own this trip.");
    }
    const target = await this.requireTargetMembership(ctx, targetUserId);
    if (!target.user.emailVerified) {
      throw new ForbiddenException(
        "That member must verify their email before becoming the owner.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tripMembership.update({
        where: { id: target.id },
        data: { role: "OWNER" },
      });
      await tx.tripMembership.update({
        where: {
          tripId_userId: { tripId: ctx.trip.id, userId: actor.id },
        },
        data: { role: "CO_ORGANIZER" },
      });
      await tx.trip.update({
        where: { id: ctx.trip.id },
        data: { ownerId: targetUserId, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: memberAudit(
          ctx.trip.id,
          actor.id,
          "OWNERSHIP_TRANSFERRED",
          targetUserId,
          { targetName: target.user.displayName },
        ),
      });
    });
  }

  /**
   * Mute or unmute this trip's notification **email** for the caller (Phase
   * 5.3). Writes the caller's own membership row — identified by the id the
   * trip-context guard already resolved, so there is no target to authorize and
   * no way to aim this at somebody else's membership.
   *
   * Idempotent: setting the value it already has is a success, and the stored
   * state comes back so the client renders server truth.
   */
  async setMute(ctx: TripContext, muted: boolean): Promise<TripMuteView> {
    const updated = await this.prisma.tripMembership.update({
      where: { id: ctx.membershipId },
      data: { muted },
      select: { muted: true },
    });
    return { tripId: ctx.trip.id, muted: updated.muted };
  }
}
