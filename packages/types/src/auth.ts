import { z } from "zod";
import { localeSchema } from "./locale.js";

/**
 * Auth contract — the first real shared schemas (Phase 0.3).
 *
 * These Zod schemas are the single source of truth for the auth boundary:
 * the backend validates requests with them, the front-ends drive forms and
 * typed API hooks from them. Because both sides infer their types from the
 * same schema, a change here that isn't matched on both sides breaks the
 * typecheck rather than failing at runtime.
 */

/** Normalised email: trimmed + lower-cased, must be a valid address. */
export const emailSchema = z.string().trim().toLowerCase().email();

/** Password policy for registration (min length enforced; upper bound guards hashing cost). */
export const passwordSchema = z.string().min(8).max(128);

/** Human-facing display name. */
export const displayNameSchema = z.string().trim().min(1).max(80);

export const RegisterInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: emailSchema,
  // Deliberately loose on login — never signal the password policy to callers.
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const VerifyEmailInput = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailInput>;

/**
 * Registration result — deliberately constant. To avoid account enumeration
 * (FR-5), the server responds identically whether or not the email already had
 * an account; the client simply tells the user to check their inbox either way.
 */
export const RegisterResult = z.object({
  status: z.literal("verification_sent"),
});
export type RegisterResult = z.infer<typeof RegisterResult>;

/** Public user shape returned by the auth endpoints (no secrets). */
export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  /** Profile picture, or null when none is set — the UI draws initials then
   *  (Phase 6.2). Always a URL this service issued. */
  avatarUrl: z.string().nullable(),
  /**
   * Whether this deployment treats the account as an operator (post-launch).
   *
   * Present so the app knows whether to offer the console's link; it is **not**
   * what protects it. The routes are guarded server-side against the same
   * configuration, so flipping this in a debugger reveals a link to a page
   * whose every request 404s.
   */
  isAdmin: z.boolean(),
  /**
   * The language this account reads the app in (post-launch).
   *
   * On the session rather than fetched separately, because it is needed to render
   * the very first screen after sign-in — a language that arrives one request
   * later would repaint the app in front of the reader.
   */
  locale: localeSchema,
});
export type AuthUser = z.infer<typeof AuthUser>;

/**
 * Login result. The short-lived access token is held in memory by the client;
 * the refresh token is delivered separately as an httpOnly cookie (see the
 * auth model in the SRS), so it is intentionally absent from this body.
 */
export const LoginResult = z.object({
  accessToken: z.string(),
  user: AuthUser,
});
export type LoginResult = z.infer<typeof LoginResult>;
