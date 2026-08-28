import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { InvitePreview, JoinTripResult } from "@gtp/types";
import type { User } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { INVITE_PREVIEW_THROTTLE } from "../common/throttle-policy.js";
import { InvitesService } from "./invites.service.js";

/**
 * Token redemption (Phase 1.3, SRS FR-15). A web route, not nested under a trip:
 * the token is the only reference the redeemer holds. Authenticated only — the
 * token carries the join authorization, so the caller need not already be a
 * member. **Not** verified-email gated at the route level: Guests/Participants
 * may join unverified; the verified-email requirement for a Co-organizer grant
 * is enforced inside the service, where the resulting role is known.
 *
 * A logged-out arrival is handled entirely on the front-end: the token rides the
 * `/login?next=/join/:token` redirect and is POSTed here after authentication
 * (Phase-1 decision 3 — no server-side pending-join state).
 */
@Controller("join")
export class JoinController {
  constructor(private readonly invites: InvitesService) {}

  /**
   * What the link leads to, before there is anyone to say it leads there for.
   *
   * **Behind no auth guard, and declared before nothing** — it is a different
   * verb on the same path, so it cannot shadow or be shadowed by the redemption
   * below. The service decides what a visitor may see; this route's whole job is
   * to not require a session, because requiring one is the problem it fixes.
   */
  @Get(":token/preview")
  @Throttle(INVITE_PREVIEW_THROTTLE)
  preview(@Param("token") token: string): Promise<InvitePreview> {
    return this.invites.preview(token);
  }

  @Post(":token")
  @UseGuards(JwtAuthGuard)
  join(
    @CurrentUser() user: User,
    @Param("token") token: string,
  ): Promise<JoinTripResult> {
    return this.invites.join(user, token);
  }
}
