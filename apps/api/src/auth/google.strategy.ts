import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, type Profile } from "passport-google-oauth20";
import type { User } from "@prisma/client";
import type { Env } from "../config/env.js";
import { AuthService } from "./auth.service.js";

/**
 * Google OAuth 2.0 strategy (Phase 1.0, FR-1). Server-side authorization-code
 * flow: Passport redirects to Google, Google calls back with a code, this
 * strategy exchanges it and hands us the profile. We resolve it to our own User
 * (find-or-create, email-verified) and let the callback issue the standard
 * access/refresh pair — so a Google session is identical to an email one.
 *
 * Constructed only when the OAuth client is configured (see AuthModule); the
 * `super({...})` call registers the "google" strategy with Passport.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(
    env: Env & {
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_CALLBACK_URL: string;
    },
    private readonly auth: AuthService,
  ) {
    super({
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ["email", "profile"],
    });
  }

  /**
   * Passport verify callback. Returns the resolved User, which Nest attaches as
   * `request.user` for the callback handler. A profile with no email (scope not
   * granted) is rejected.
   */
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<User> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      throw new UnauthorizedException("Google account has no email address.");
    }
    return this.auth.validateGoogleProfile({
      email,
      displayName: profile.displayName ?? "",
    });
  }
}
