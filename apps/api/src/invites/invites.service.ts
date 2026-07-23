import { randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import {
  ROLE_RANK,
  maxTripMembers,
  resolveJoin,
  type CreateInviteInput,
  type InviteLinkView,
  type JoinTripResult,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "../email/email.service.js";
import type { TripContext } from "../trips/trip-context.js";
import { toInviteLinkView } from "./invite.mapper.js";

/** How many active global links a trip may have — one per invitable role
 * (Guest/Participant/Co-organizer), so at most three (SRS FR-13). Not a literal
 * sprinkled around: the "one active global per role" rule below produces it. */

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** A high-entropy, URL-safe invite token (SRS §6: tokens are random strings). */
  private generateToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /**
   * Create an invite link (Owner/Co-organizer, verified-email gated by the route
   * guards). Two extra rules enforced here:
   *  - **A link may only grant a role strictly below the creator's own** — so a
   *    Co-organizer cannot mint Co-organizer (peer) links, closing the
   *    invite-based privilege-escalation path that `canActOn` closes for direct
   *    member management.
   *  - **Global links are capped at one active link per role** (→ ≤3/trip): a
   *    second active global for the same role is a 409.
   * A personal link is single-use; if an address is supplied it is emailed the
   * link (best-effort — the link works regardless, and stays unbound).
   */
  async createInvite(
    ctx: TripContext,
    creator: User,
    input: CreateInviteInput,
  ): Promise<InviteLinkView> {
    if (ROLE_RANK[input.role] >= ROLE_RANK[ctx.role]) {
      throw new ForbiddenException(
        "You can only invite people to a role below your own.",
      );
    }

    if (input.type === "GLOBAL") {
      const existingActive = await this.prisma.inviteLink.findFirst({
        where: {
          tripId: ctx.trip.id,
          type: "GLOBAL",
          role: input.role,
          disabledAt: null,
        },
      });
      if (existingActive) {
        throw new ConflictException(
          "A global link for this role already exists. Disable it first to make a new one.",
        );
      }
    }

    const link = await this.prisma.inviteLink.create({
      data: {
        tripId: ctx.trip.id,
        type: input.type,
        role: input.role,
        token: this.generateToken(),
        // Only personal links carry a target address; a global link is broadcast.
        sentToEmail: input.type === "PERSONAL" ? (input.email ?? null) : null,
        createdById: creator.id,
      },
    });

    if (link.type === "PERSONAL" && link.sentToEmail) {
      // Best-effort: a delivery failure must not fail link creation (the link is
      // already usable; the creator can copy it directly).
      try {
        await this.email.sendInviteEmail(
          link.sentToEmail,
          link.token,
          ctx.trip.name,
        );
      } catch (err) {
        this.logger.warn(
          `Invite email to ${link.sentToEmail} failed: ${String(err)}`,
        );
      }
    }

    return toInviteLinkView(link);
  }

  /** All invite links for a trip (management view), newest first. */
  async listInvites(ctx: TripContext): Promise<InviteLinkView[]> {
    const links = await this.prisma.inviteLink.findMany({
      where: { tripId: ctx.trip.id },
      orderBy: { createdAt: "desc" },
    });
    return links.map(toInviteLinkView);
  }

  /**
   * Disable a link (soft): sets `disabledAt`, stopping new joins. Already-joined
   * members are retained — disabling never touches memberships (SRS FR-13). The
   * link is looked up **scoped to this trip**, so an id from another trip is a
   * plain 404 (no cross-trip disable).
   */
  async disableInvite(
    ctx: TripContext,
    inviteId: string,
  ): Promise<InviteLinkView> {
    const link = await this.prisma.inviteLink.findFirst({
      where: { id: inviteId, tripId: ctx.trip.id },
    });
    if (!link) throw new NotFoundException("Invite link not found");
    if (link.disabledAt) return toInviteLinkView(link); // idempotent

    const updated = await this.prisma.inviteLink.update({
      where: { id: link.id },
      data: { disabledAt: new Date() },
    });
    return toInviteLinkView(updated);
  }

  /**
   * Redeem a token (SRS FR-15/16). The caller is authenticated (route guard);
   * the token itself carries the authorization to join, so the redeemer need not
   * be a member. Rules enforced, in order:
   *  - unknown token → 404; disabled or already-consumed → 410;
   *  - History trip → refused (403): frozen trips take no new members;
   *  - a **blocked** user is refused (403): the TripBlock bar survives ejection
   *    and no live link can let them back in (SRS FR-17);
   *  - a Co-organizer **grant** requires a verified email (the §3 promotion gate);
   *  - the role change follows {@link resolveJoin} — idempotent, upgrade-only,
   *    never a downgrade;
   *  - a **JOIN** (a genuinely new member) is refused once the trip is at the
   *    policy-layer member cap (SRS FR-11) — resolved via `maxTripMembers`, never
   *    a literal. An upgrade of an existing member is exempt (no head added).
   * A personal link is consumed on a real join/upgrade (not on an idempotent
   * no-op).
   */
  async join(user: User, token: string): Promise<JoinTripResult> {
    const link = await this.prisma.inviteLink.findUnique({
      where: { token },
      include: { trip: { select: { id: true, status: true } } },
    });
    if (!link) throw new NotFoundException("This invite link is invalid.");
    if (link.disabledAt) {
      throw new GoneException("This invite link has been disabled.");
    }
    if (link.type === "PERSONAL" && link.consumedAt) {
      throw new GoneException("This invite link has already been used.");
    }
    if (link.trip.status === "HISTORY") {
      throw new ForbiddenException(
        "This trip has ended and is no longer accepting new members.",
      );
    }

    // A hard bar survives ejection (FR-17): a blocked user cannot rejoin by any
    // link, live or not. Checked before membership resolution.
    const block = await this.prisma.tripBlock.findUnique({
      where: { tripId_userId: { tripId: link.tripId, userId: user.id } },
    });
    if (block) {
      throw new ForbiddenException(
        "You've been removed from this trip and can't rejoin.",
      );
    }

    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId: link.tripId, userId: user.id } },
    });
    const currentRole = membership?.role ?? null;
    const { action, resultRole } = resolveJoin(currentRole, link.role);

    // Member cap (FR-11) applies only to a genuinely new member; an upgrade adds
    // no head. Resolved through the policy layer, never a hardcoded limit.
    if (action === "JOIN") {
      const memberCount = await this.prisma.tripMembership.count({
        where: { tripId: link.tripId },
      });
      if (memberCount >= maxTripMembers()) {
        throw new ForbiddenException("This trip is full.");
      }
    }

    // The verified-email promotion gate (SRS §3): only when this redemption
    // actually grants Co-organizer (a JOIN or UPGRADE to it, never a no-op).
    if (
      action !== "NOOP" &&
      resultRole === "CO_ORGANIZER" &&
      !user.emailVerified
    ) {
      throw new ForbiddenException(
        "Verify your email address before accepting a co-organizer invite.",
      );
    }

    const consumePersonal = link.type === "PERSONAL" && action !== "NOOP";

    try {
      await this.prisma.$transaction(async (tx) => {
        if (action === "JOIN") {
          await tx.tripMembership.create({
            data: {
              tripId: link.tripId,
              userId: user.id,
              role: resultRole,
              joinedViaInviteId: link.id,
            },
          });
        } else if (action === "UPGRADE") {
          await tx.tripMembership.update({
            where: { tripId_userId: { tripId: link.tripId, userId: user.id } },
            data: { role: resultRole },
          });
        }
        if (consumePersonal) {
          await tx.inviteLink.update({
            where: { id: link.id },
            data: { consumedAt: new Date() },
          });
        }
      });
    } catch (err) {
      // Concurrent double-join: the unique (tripId,userId) constraint is the
      // backstop. Treat it as "already a member" and report the existing role.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await this.prisma.tripMembership.findUnique({
          where: { tripId_userId: { tripId: link.tripId, userId: user.id } },
        });
        return {
          tripId: link.tripId,
          role: existing?.role ?? link.role,
          alreadyMember: true,
        };
      }
      throw err;
    }

    return {
      tripId: link.tripId,
      role: resultRole,
      alreadyMember: currentRole !== null,
    };
  }
}
