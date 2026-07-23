import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  planAccountDeletion,
  type AccountDeletionImpact,
  type OwnedTripForDeletion,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Account deletion (Phase 1.5, SRS FR-6 / GDPR Art. 17) — the highest-logic-density
 * flow after atomic locking. Deletion is always available; the whole cascade runs
 * in **one transaction** so a crash never leaves an owner-less trip, a half-purged
 * user, or a live session behind. The branching (transfer vs delete) is decided by
 * the pure {@link planAccountDeletion}, so the preview the user acknowledged and the
 * mutation executed here are computed identically.
 */
@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load the trips this user owns, each with its *other* members (the owner
   * excluded) projected to what the successor cascade needs. Runs against the
   * transaction client when one is passed, so the deletion reads and writes a
   * single consistent snapshot.
   */
  private async loadOwnedTrips(
    userId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OwnedTripForDeletion[]> {
    const trips = await client.trip.findMany({
      where: { ownerId: userId },
      include: {
        memberships: {
          where: { userId: { not: userId } },
          include: { user: { select: { displayName: true } } },
        },
      },
    });
    return trips.map((trip) => ({
      tripId: trip.id,
      tripName: trip.name,
      otherMembers: trip.memberships.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        displayName: m.user.displayName,
      })),
    }));
  }

  /**
   * Preview the impact of deleting this account: which owned trips transfer (and
   * to whom) and which solo-owned trips are deleted. Drives the warning prompt.
   */
  async previewDeletion(userId: string): Promise<AccountDeletionImpact> {
    return planAccountDeletion(await this.loadOwnedTrips(userId));
  }

  /**
   * Delete the account (GDPR erasure). In one transaction:
   *  - **transfer** each owned trip with a successor (promote them to OWNER,
   *    repoint the denormalized `ownerId`, bump `version` so open editors reload);
   *  - **delete** each solo/Guest-only owned trip (cascades its content);
   *  - drop **all** of the user's remaining memberships (the outgoing OWNER rows on
   *    transferred trips + any Participant/Guest memberships elsewhere);
   *  - **anonymize** the User row — personal data purged, the row retained so
   *    content authored later renders as "Deleted user";
   *  - **revoke every live refresh token** (kills all sessions).
   *
   * The access-token guard, login, and refresh all already reject an anonymized
   * user, so no valid session survives this.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const plan = planAccountDeletion(await this.loadOwnedTrips(userId, tx));

      for (const transfer of plan.transfers) {
        await tx.tripMembership.update({
          where: {
            tripId_userId: {
              tripId: transfer.tripId,
              userId: transfer.successorUserId,
            },
          },
          data: { role: "OWNER" },
        });
        await tx.trip.update({
          where: { id: transfer.tripId },
          data: {
            ownerId: transfer.successorUserId,
            version: { increment: 1 },
          },
        });
      }

      if (plan.deletions.length > 0) {
        await tx.trip.deleteMany({
          where: { id: { in: plan.deletions.map((d) => d.tripId) } },
        });
      }

      // Remove the user from every remaining trip (owner rows on transferred
      // trips are demoted to nothing — the user is leaving entirely).
      await tx.tripMembership.deleteMany({ where: { userId } });

      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          // A deterministic, non-routable sentinel: keeps the `email` unique
          // constraint satisfied while purging the real address irreversibly.
          email: `deleted-${userId}@deleted.invalid`,
          displayName: "Deleted user",
          passwordHash: null,
          emailVerified: false,
          anonymizedAt: now,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }
}
