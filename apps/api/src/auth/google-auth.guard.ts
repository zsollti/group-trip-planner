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
 * Clamp the post-sign-in path to a same-site absolute path — the server-side
 * mirror of the front-ends' `safeNextPath`. Only `/…` is honoured, never a
 * protocol-relative `//evil.com` (nor the `/\evil.com` variant browsers
 * normalize to an authority). Anything else falls back to the app root.
 */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  return candidate;
}

/**
 * The OAuth `state` handed to Google: the absolute URL to return the browser
 * to, i.e. the front-end origin plus the path the user was headed for (an
 * invite's `/join/:token`, say). Both halves are clamped here *and* again in
 * {@link resolveReturnUrl}, because `state` comes back through the browser and
 * is therefore attacker-controllable at the callback.
 */
export function buildReturnState(
  origin: unknown,
  next: unknown,
  env: Env,
): string {
  return `${resolveReturnOrigin(origin, env)}${safeReturnPath(next)}`;
}

/**
 * Turn the echoed `state` back into a safe absolute return URL. Falls back to
 * the default origin's root when the value is missing, unparseable, or points
 * at an origin outside the CORS allowlist.
 */
export function resolveReturnUrl(state: unknown, env: Env): string {
  if (typeof state === "string" && state !== "") {
    try {
      const url = new URL(state);
      if (env.CORS_ORIGINS.includes(url.origin)) {
        return `${url.origin}${safeReturnPath(`${url.pathname}${url.search}`)}`;
      }
    } catch {
      // Not a URL at all — fall through to the default below.
    }
  }
  return `${resolveReturnOrigin(state, env)}/`;
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
 * The Passport "google" guard, extended to carry the return target through the
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
      state: buildReturnState(req.query.redirect, req.query.next, this.env),
    };
  }
}
