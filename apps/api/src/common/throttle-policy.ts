/**
 * Every rate limit in one place (Phase 7.1).
 *
 * Until now the budgets were local `const`s next to the routes they guarded —
 * two in the auth controller, one in the uploads controller — which made the
 * overall abuse posture impossible to read without grepping. Phase 6.1
 * deliberately left the upload budget in that shape with a note to unify it
 * here. This is that unification: the policy is the artefact, and each entry
 * says what it is protecting and why it is set where it is.
 *
 * Three tiers, by what the limit is keyed on:
 *
 * 1. **The global floor** (`THROTTLE_LIMIT`/`THROTTLE_TTL_SECONDS`, in `env`)
 *    applies per IP to every HTTP route via the `APP_GUARD` ThrottlerGuard.
 * 2. **Pre-auth limits** are per IP, because there is no user yet. These are
 *    the brute-force surface, so they are the tight ones.
 * 3. **Per-user limits** are keyed on the account (`UserThrottlerGuard`) and
 *    protect expensive or spammable writes. An IP key is the wrong unit once
 *    a caller is authenticated: one office NAT would share a budget while one
 *    account hopping networks would keep getting fresh ones.
 *
 * The numbers are deliberately **generous** (the DoD's word): they exist to
 * blunt scripted abuse, not to get in a real group's way mid-planning. Where a
 * limit would be felt by an enthusiastic human it is set above what that human
 * plausibly does.
 */

/** A `@Throttle()` budget. `ttl` is milliseconds. */
type Budget = { default: { limit: number; ttl: number } };

const minute = 60_000;
const hour = 60 * minute;

/**
 * A pre-auth limit, overridable by environment.
 *
 * **The default is the policy; the override exists for one caller.** The
 * browser suite signs in roughly a dozen accounts inside a minute, serially,
 * from one address — which is exactly the shape the per-IP sign-in budget is
 * meant to refuse, and it is right to refuse it. Weakening the constant to make
 * a test pass would trade a real brute-force control for convenience, so the
 * number stays and the *harness* opts out (see `e2e/playwright.config.ts`).
 *
 * Read straight from `process.env` rather than the validated `env` module
 * because these are consumed by decorators at class-definition time, before the
 * Nest config module has run. Anything unparseable falls back to the policy
 * value, so a typo cannot silently raise a limit.
 */
export function budget(name: string, fallback: number, ttl: number): Budget {
  const raw = process.env[name]?.trim();
  // Plain digits only, checked *before* converting. `Number()` is far too
  // willing here: it reads "1e3" as 1000, so a single stray character in a
  // deploy variable would multiply a brute-force limit by a hundred and nothing
  // would say so. A malformed value must leave the control where the policy put
  // it, which is the whole reason the override is safe to have.
  const ok = raw !== undefined && /^[0-9]+$/.test(raw) && Number(raw) > 0;
  return { default: { limit: ok ? Number(raw) : fallback, ttl } };
}

/* -------------------------------------------------------------------------- */
/* Pre-auth (per IP)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Account creation. Low, because the only legitimate reason to hit this
 * repeatedly is a typo, and each call sends mail and runs an argon2 hash.
 */
export const REGISTER_THROTTLE: Budget = budget(
  "REGISTER_THROTTLE_LIMIT",
  5,
  minute,
);

/**
 * Password sign-in — the brute-force target. Kept per IP rather than per email
 * on purpose: a per-email counter is an oracle, since an attacker could watch
 * which addresses start refusing and learn that they exist. The generic 401
 * and the dummy-argon2 timing from Phase 0.6 only hold if the limiter stays
 * silent about identity too.
 */
export const LOGIN_THROTTLE: Budget = budget(
  "LOGIN_THROTTLE_LIMIT",
  10,
  minute,
);

/**
 * Email-verification token submission. Previously governed only by the global
 * floor, which left ~100 guesses a minute against a token whose whole job is
 * to be unguessable — so this is the one genuinely new auth limit in 7.1.
 * A real person submits this once, by clicking a link.
 */
export const VERIFY_THROTTLE: Budget = { default: { limit: 10, ttl: minute } };

/* -------------------------------------------------------------------------- */
/* Per-user writes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Image uploads (Phase 6.1). Each one decodes and re-encodes through `sharp`,
 * so this is the most CPU-expensive route in the app and the tightest budget.
 */
export const UPLOAD_THROTTLE: Budget = { default: { limit: 10, ttl: minute } };

/**
 * Trip creation. Every trip seeds categories and a chat channel, so a script
 * looping on it writes a lot per call. An hour window suits the action: nobody
 * legitimately starts twenty trips in an afternoon, but a burst of a few while
 * setting things up is normal.
 */
export const TRIP_CREATE_THROTTLE: Budget = {
  default: { limit: 20, ttl: hour },
};

/**
 * Proposing options. The one write a keen planner really does do in bursts —
 * pasting in ten hotels in a row is the product working — so this is set well
 * above human enthusiasm and only catches scripts.
 */
export const OPTION_CREATE_THROTTLE: Budget = {
  default: { limit: 60, ttl: minute },
};

/**
 * Minting invite links. Each one is a credential that grants trip access, and
 * personal invites send mail, so this is bounded harder than ordinary writes.
 */
export const INVITE_CREATE_THROTTLE: Budget = {
  default: { limit: 30, ttl: hour },
};

/**
 * Rebuilding the demo trip from the operator console.
 *
 * The tightest budget in the policy, and the only one whose reason is not abuse:
 * the route is already behind both admin guards, so nobody unauthorised can
 * reach it at all. What this bounds is the operator's own double-click. One run
 * deletes and rewrites the whole demo — five upserts, an argon2 hash, fifty-odd
 * inserts — and two of them racing would interleave those writes against each
 * other. Three an hour is more than anyone needs to reset a demo and far too few
 * to overlap by accident.
 */
export const DEMO_SEED_THROTTLE: Budget = { default: { limit: 3, ttl: hour } };

/* -------------------------------------------------------------------------- */
/* Socket events (per user, enforced in the gateway)                          */
/* -------------------------------------------------------------------------- */

/**
 * Chat messages per user per minute.
 *
 * Not a `@Throttle()` budget: `ThrottlerGuard` resolves its request and
 * response through `context.switchToHttp()`, which on a gateway hands back the
 * socket client and the message payload rather than an HTTP pair — so it
 * cannot govern a `@SubscribeMessage` handler, and message sending had no
 * limit of any kind before 7.1. The gateway applies this itself, and answers
 * over-budget sends with a normal `{ ok: false }` ack so the client shows its
 * failed-send state instead of losing the connection.
 *
 * Chat is the most naturally bursty thing in the app, so the budget is high:
 * it stops a script, not a lively argument about where to eat.
 */
export const MESSAGE_BURST = 30;
export const MESSAGE_WINDOW_MS = minute;
