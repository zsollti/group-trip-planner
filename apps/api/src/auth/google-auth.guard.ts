import {
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { ENV } from "../config/config.module.js";
import { isGoogleOAuthEnabled, type Env } from "../config/env.js";

/**
 * Resolve the front-end origin to return to after sign-in. The candidate (from
 * `?redirect=` on initiate, echoed back as OAuth `state` on callback) is checked
 * against the CORS allowlist — so it doubles as an **open-redirect guard**: an
 * unknown origin falls back to `WEB_APP_URL`.
 */
export function resolveReturnOrigin(
  candidate: unknown,
  env: Env,
): string {
  if (typeof candidate === "string" && env.CORS_ORIGINS.includes(candidate)) {
    return candidate;
  }
  return env.CORS_ORIGINS[0] ?? env.WEB_APP_URL;
}

/**
 * Runs before {@link GoogleAuthGuard}: if Google OAuth isn't configured, the
 * routes behave as if they don't exist (404) instead of 500-ing on an unknown
 * Passport strategy. Keeps the app bootable without Google creds.
 */
@Injectable()
export class GoogleConfiguredGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(): boolean {
    if (!isGoogleOAuthEnabled(this.env)) {
      throw new NotFoundException();
    }
    return true;
  }
}

/**
 * The Passport "google" guard, extended to carry the return origin through the
 * OAuth round-trip as `state` and to run stateless (no server session — we set
 * our own refresh cookie in the callback).
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  override getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    return {
      session: false,
      state: resolveReturnOrigin(req.query.redirect, this.env),
    };
  }
}
