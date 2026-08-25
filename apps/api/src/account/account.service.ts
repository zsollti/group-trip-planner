import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import {
  avatarPresetUrl,
  randomAvatarLook,
  type AvatarColour,
  planAccountDeletion,
  type AvatarPreset,
  type AccountDeletionImpact,
  type AuthUser,
  type NotificationPreferences,
  type OwnedTripForDeletion,
  type UpdateNotificationPreferencesInput,
  type UpdateProfileInput,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { toAuthUser } from "../auth/auth.mapper.js";
import { ImageAttachmentService } from "../uploads/image-attachment.service.js";
import type { UploadedImageFile } from "../uploads/uploads.service.js";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageAttachmentService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The caller's notification preferences (Phase 5.3). Read straight off the
   * user row — the same flags {@link shouldSendMentionEmail} gates enqueues on,
   * so what the settings screen shows is exactly what the queue enforces.
   */
  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { emailOnMention: true },
    });
    return { emailOnMention: user.emailOnMention };
  }

  /**
   * Update the caller's preferences and return the stored result, so the client
   * renders server truth rather than its own optimistic guess. Partial by
   * design: only the fields present are written.
   */
  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.emailOnMention === undefined
          ? {}
          : { emailOnMention: input.emailOnMention }),
      },
      select: { emailOnMention: true },
    });
    return { emailOnMention: updated.emailOnMention };
  }

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
    // Read before the transaction so the object can be dropped after it commits
    // — a storage failure must not roll back an erasure the user asked for.
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

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
          // A photograph of someone is personal data, so erasure has to take it
          // too — the row keeps rendering as "Deleted user" with initials.
          avatarUrl: null,
          anonymizedAt: now,
        },
      });

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    // The row no longer references it; now remove the bytes (best-effort — the
    // erasure itself has already committed).
    await this.images.discard(before?.avatarUrl ?? null);
  }

  /**
   * Set or replace the caller's avatar (Phase 6.2). The image passes the
   * Phase-6.1 pipeline before the row is repointed, and the object behind the
   * old URL is dropped once it is.
   */
  async setAvatar(user: User, file: UploadedImageFile): Promise<AuthUser> {
    const stored = await this.images.replace(file, user.id, user.avatarUrl);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: stored.url },
    });
    return toAuthUser(updated, this.env.ADMIN_EMAILS);
  }

  /**
   * Rename yourself, change the language you read the app in, or put the
   * guided tour behind you (post-launch).
   *
   * A plain column write, and deliberately nothing more. The display name is
   * denormalized nowhere — every surface that shows it (a proposal's proposer,
   * a vote's avatar, a chat author, the crew panel) reads it through a join at
   * request time, so one row changing is the whole change. The two places that
   * *do* snapshot a name are the trip activity feed and the admin log, and both
   * snapshot it precisely so history keeps saying what it said at the time.
   */
  async updateProfile(
    user: User,
    input: UpdateProfileInput,
  ): Promise<AuthUser> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      // Spread the fields that were actually sent. Writing `displayName:
      // input.displayName` unconditionally would set it to `undefined` on a
      // request that only changed the language — which Prisma reads as "leave it
      // alone" today, but relies on that reading rather than saying so, and the
      // same line with a `null`-able column would erase the field instead.
      data: {
        ...(input.displayName !== undefined && {
          displayName: input.displayName,
        }),
        ...(input.locale !== undefined && { locale: input.locale }),
        // A boolean in, a timestamp out. `false` re-offers the tour rather than
        // recording that it was refused — there is nothing to record, since the
        // only thing the column is ever asked is "has this account seen it".
        ...(input.tourCompleted !== undefined && {
          tourCompletedAt: input.tourCompleted ? new Date() : null,
        }),
      },
    });
    return toAuthUser(updated, this.env.ADMIN_EMAILS);
  }

  /**
   * Wear one of the drawn marks (`AVATAR_PRESETS`) instead of a picture.
   *
   * The preset is stored in `avatarUrl` behind a `preset:` scheme — see the
   * contract for why there is no second column. The object behind any previous
   * *upload* is deleted, exactly as removing the avatar would: choosing a tent
   * is a way of saying "not that photograph any more", and leaving the file on
   * disk would keep it addressable to anyone who still had the URL.
   *
   * `discard` is safe to hand the old value whatever it is — a `preset:` string
   * is not one of our object URLs, so `nameFromUrl` returns null and it is a
   * no-op. Switching between two marks deletes nothing.
   */
  async setAvatarPreset(
    user: User,
    preset: AvatarPreset,
    colour?: AvatarColour,
  ): Promise<AuthUser> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: avatarPresetUrl(preset, colour) },
    });
    await this.images.discard(user.avatarUrl);
    return toAuthUser(updated, this.env.ADMIN_EMAILS);
  }

  /**
   * Take the uploaded picture away and put a drawn mark in its place.
   *
   * It used to write `null`, which meant "back to initials" — and initials read
   * as a field somebody has not filled in yet rather than as a person. Removing
   * a photograph is a decision about *that photograph*, so what should follow
   * is another avatar, not an empty circle.
   *
   * Random, and deliberately not the one they had before: this is the same
   * gesture as "give me a different one", and handing back the mark they just
   * removed would look like the button had failed. Accounts that predate this
   * and still hold `null` are left alone — they show initials, which is a
   * perfectly good fallback and is what their crew already recognises them by.
   */
  async removeAvatar(user: User): Promise<AuthUser> {
    const look = randomAvatarLook();
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: avatarPresetUrl(look.preset, look.colour) },
    });
    await this.images.discard(user.avatarUrl);
    return toAuthUser(updated, this.env.ADMIN_EMAILS);
  }
}
