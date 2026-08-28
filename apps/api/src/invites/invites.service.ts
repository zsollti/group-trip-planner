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
  invitedAddressMatches,
  maxTripMembers,
  resolveJoin,
  type CreateInviteInput,
  type InviteLinkView,
  type InvitePreview,
  type JoinTripResult,
} from "@gtp/types";
import { localizedException } from "../i18n/localized-message.js";
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
  /**
   * What the link leads to, for somebody who has not signed in.
   *
   * **The link is the credential, and it already was.** Redeeming this token
   * puts the holder on the board with a role; this shows them the board with no
   * role at all, so nothing is reachable here that was not reachable before by
   * pressing on. What it buys is that "what have I been invited to" stops
   * requiring an account to answer.
   *
   * The same three refusals redemption makes, for the same reasons and in the
   * same order — unknown token, disabled link, spent personal link. A dead link
   * shows nothing, or a revoked one would go on being a window into the trip
   * after the organizer closed it. What it does **not** repeat is the address
   * check on a personal link: that is a rule about who may *join*, and there is
   * nobody to check an address against until somebody signs in. The link is the
   * secret either way, and holding it is the whole of what this trusts.
   *
   * A frozen trip still previews. It refuses new members, which is a fact the
   * reader is better told than left to discover by making an account for it, so
   * it comes back as `acceptingMembers: false` rather than as a 403.
   *
   * Everything selected here is selected by name. A preview that spread a row
   * would leak the next column somebody adds to it, and the columns next door
   * are email addresses and password hashes.
   */
  async preview(token: string): Promise<InvitePreview> {
    const link = await this.prisma.inviteLink.findUnique({
      where: { token },
      select: { type: true, disabledAt: true, consumedAt: true, tripId: true },
    });
    if (!link) throw new NotFoundException("This invite link is invalid.");
    if (link.disabledAt) {
      throw new GoneException("This invite link has been disabled.");
    }
    if (link.type === "PERSONAL" && link.consumedAt) {
      throw new GoneException("This invite link has already been used.");
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: link.tripId },
      select: {
        id: true,
        name: true,
        description: true,
        destination: true,
        startDate: true,
        endDate: true,
        defaultCurrency: true,
        status: true,
        memberships: {
          select: {
            user: { select: { id: true, displayName: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: "asc" },
        },
        categories: {
          select: {
            id: true,
            name: true,
            builtinKey: true,
            paletteKey: true,
            position: true,
            options: {
              where: { deletedAt: null },
              select: {
                id: true,
                title: true,
                description: true,
                url: true,
                amount: true,
                currency: true,
                costType: true,
                startsAt: true,
                endsAt: true,
                status: true,
                // The tally, and only the tally. `votes: true` would carry
                // every voter's id and name out with it.
                _count: { select: { votes: true } },
              },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            },
          },
          orderBy: { position: "asc" },
        },
      },
    });
    // A link whose trip is gone. The link row cascades with the trip, so this
    // is all but unreachable — and "all but" is not a thing to return null over.
    if (!trip) throw new NotFoundException("This invite link is invalid.");

    return {
      tripId: trip.id,
      name: trip.name,
      description: trip.description,
      destination: trip.destination,
      // `@db.Date` columns: sliced to the calendar day they mean, never
      // formatted as an instant. See the timeline pass.
      startDate: trip.startDate ? trip.startDate.toISOString() : null,
      endDate: trip.endDate ? trip.endDate.toISOString() : null,
      defaultCurrency: trip.defaultCurrency,
      acceptingMembers: trip.status !== "HISTORY",
      memberCount: trip.memberships.length,
      members: trip.memberships.map((m) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
      })),
      lanes: trip.categories.map((c) => ({
        id: c.id,
        name: c.name,
        builtinKey: c.builtinKey,
        paletteKey: c.paletteKey,
        position: c.position,
        options: c.options.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          url: o.url,
          amount: o.amount === null ? null : Number(o.amount),
          currency: o.currency,
          costType: o.costType,
          startsAt: o.startsAt ? o.startsAt.toISOString() : null,
          endsAt: o.endsAt ? o.endsAt.toISOString() : null,
          locked: o.status === "LOCKED",
          voteCount: o._count.votes,
        })),
      })),
    };
  }

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
    // A personal link is for one person, and now says which. Checked before the
    // trip's own state so the answer does not depend on what else is wrong: a
    // link that is not yours should say so whether the board is frozen or not.
    //
    // The address is named in the refusal on purpose. The commonest way to hit
    // this is not an attack — it is being invited at a work address and signed
    // in with a personal one, and "you can't use this" without saying which
    // account would is a dead end. It leaks nothing the reader does not already
    // hold: they are looking at a link that was mailed to that address.
    if (
      link.type === "PERSONAL" &&
      !invitedAddressMatches(link.sentToEmail, user.email)
    ) {
      throw localizedException(
        (m) => new ForbiddenException(m),
        "This invite was sent to {email}. Sign in with that address to use it.",
        { email: link.sentToEmail ?? "" },
      );
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
