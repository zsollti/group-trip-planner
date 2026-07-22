import type { CookieOptions, Response } from "express";
import type { Env } from "../config/env.js";

/** Name of the httpOnly refresh-token cookie. */
export const REFRESH_COOKIE = "gtp_refresh";

/**
 * Cookie options for the refresh token: httpOnly (XSS-safe), Secure in prod,
 * SameSite per config, and scoped to `/auth` so it only rides refresh/logout
 * requests — never every API call.
 */
function baseOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
    sameSite: env.COOKIE_SAMESITE,
    path: "/auth",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setRefreshCookie(
  res: Response,
  raw: string,
  expiresAt: Date,
  env: Env,
): void {
  res.cookie(REFRESH_COOKIE, raw, {
    ...baseOptions(env),
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  });
}

export function clearRefreshCookie(res: Response, env: Env): void {
  // Options (path/domain/sameSite/secure) must match those used to set it.
  res.clearCookie(REFRESH_COOKIE, baseOptions(env));
}
