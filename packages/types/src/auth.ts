import { z } from "zod";
import { localeSchema } from "./locale.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordRules,
} from "./password.js";

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

/**
 * Password policy for registration: at least {@link PASSWORD_MIN_LENGTH}
 * characters, with a lowercase letter, an uppercase letter, a number and a
 * character that is neither.
 *
 * The rules are not spelled out here — they are {@link passwordRules}, the same
 * function the sign-up form draws its live checklist from. Written twice they
 * would drift, and the drift is silent in the direction that matters: a form
 * showing five green ticks over a server that wanted six.
 *
 * `superRefine` rather than a chain of `.regex()` calls so a password that
 * fails three rules is told about three rules. Zod stops at the first failing
 * link in a chain, which would make fixing a password a sequence of guesses.
 *
 * **Login is deliberately not held to this** (see {@link LoginInput}): the
 * policy is about the passwords we let people *create*, and applying it at sign
 * in would both leak the policy to anyone probing and lock out every account
 * made before it existed.
 */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const unmet = passwordRules(value).filter((r) => !r.met);
    for (const rule of unmet) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MESSAGE[rule.id] });
    }
  });

/** What each unmet rule says when the schema is the one doing the telling. */
const MESSAGE: Record<ReturnType<typeof passwordRules>[number]["id"], string> =
  {
    length: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    lowercase: "Add a lowercase letter.",
    uppercase: "Add an uppercase letter.",
    number: "Add a number.",
    special: "Add a special character.",
  };

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
  /**
   * When this account finished — or dismissed — the guided tour, or null if it
   * never has (post-launch).
   *
   * On the account rather than in `localStorage` because "skippable, but
   * available later" needs somewhere stable to remember it: a per-browser flag
   * means the tour ambushes the same person again from their phone, at a moment
   * they did not ask for it. On the *session* rather than a request of its own
   * because the board decides whether to offer the tour on its first paint, and
   * an answer arriving a request later would start it after the reader had
   * already begun using the page.
   *
   * A timestamp rather than a boolean for the ordinary reason: "yes" and "yes,
   * in March" cost the same to store, and only one of them can answer a
   * question later.
   */
  tourCompletedAt: z.string().datetime().nullable(),
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
