import { z } from "zod";

/**
 * Startup environment contract.
 *
 * Every value the API needs from the environment is declared here and parsed
 * once at boot. Optional values carry sane defaults; anything the app cannot
 * run without (DATABASE_URL, JWT_SECRET) is required, so a misconfigured
 * deployment fails fast at startup instead of erroring on the first request.
 */

/** Parse the string env-var forms of a boolean ("true"/"1" -> true). */
const boolFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/** The placeholder shipped in .env.example — never a real signing secret. */
const PLACEHOLDER_JWT_SECRET = "change-me-to-a-long-random-secret";

const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  // The Prisma connection string. Required — the app is useless without a DB.
  DATABASE_URL: z
    .string()
    .url()
    .refine((url) => url.startsWith("postgres"), {
      message: "must be a postgres:// or postgresql:// connection string",
    }),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // --- Auth: access-token signing + refresh/verification token lifetimes ---
  // Required. Signs the short-lived access JWT (auth claims only).
  JWT_SECRET: z.string().min(16, "must be at least 16 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // --- Refresh-cookie transport (httpOnly; Secure defaults on in prod) ---
  COOKIE_SECURE: boolFromString.optional(),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  COOKIE_DOMAIN: z.string().optional(),

  // --- CORS: the locked frontend origins allowed to send credentials ---
  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:5173,http://localhost:5174,http://localhost:5175",
    )
    .transform((s) =>
      s
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // --- Google OAuth (Phase 1.0). All three must be set to enable the Google
  //     sign-in routes; otherwise GET /auth/google 404s and the flow is off. ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // The exact redirect URI registered in the Google Cloud OAuth client, e.g.
  // http://localhost:3000/auth/google/callback (must match byte-for-byte).
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // --- Email (Resend in staging/prod; dev logs the link) ---
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Group Trip Planner <onboarding@resend.dev>"),
  // Where emailed links point (verification, Phase 0.7; the unsubscribe landing,
  // 5.3). Defaults to web-board's dev port — the Phase-3.5 winner and the only
  // app still built; deck (:5173) and feed (:5174) are frozen, so a link aimed
  // there would 404 in local dev.
  WEB_APP_URL: z.string().url().default("http://localhost:5175"),
  // The API's own externally reachable base URL. Unsubscribe links are clicked
  // from a mail client with no session, so they must hit the API directly
  // (Phase 5.2) rather than route through the SPA.
  API_PUBLIC_URL: z.string().url().default("http://localhost:3000"),

  // --- Rate limiting (global default; auth routes tighten per-route) ---
  //
  // The floor is keyed on route handler *and* IP, so it is a per-endpoint
  // backstop for everything with no budget of its own — in practice, the reads.
  //
  // It was 100 a minute, and the browser suite measured what one member costs:
  // a brisk minute on a board is ~30 hits on `GET …/options` alone, because the
  // board refetches every lane's options after each mutation. An IP key is
  // shared by everyone behind one router, so five people planning together on
  // the office wifi are already at the limit — a control that fires on the
  // product working rather than on abuse. It cost us a red CI first, which is
  // the polite version of finding out.
  //
  // 600 keeps a real backstop (10 a second per endpoint from one address) with
  // room for a group to share an address. It is not what protects the expensive
  // routes: those carry their own tighter per-user budgets, in
  // `throttle-policy.ts`.
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(600),

  // --- Error reporting (Phase 7.5) ---
  // Opt-in: unset means the Sentry SDK is never initialised. These are read
  // straight from process.env by observability/instrument.ts, which has to run
  // before this schema is parsed; they are declared here so the environment
  // contract stays complete and a malformed value still fails startup.
  SENTRY_DSN: z.string().url().optional(),
  // Separates production events from a local reproduction in the Sentry UI.
  // Defaults to NODE_ENV at init time.
  SENTRY_ENVIRONMENT: z.string().optional(),
  // Identifies the build a report came from. Set it to the deployed commit.
  SENTRY_RELEASE: z.string().optional(),
  // Performance tracing is off by default — errors are what this deployment
  // needs, and spans are the expensive half of the free-tier quota.
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- Image uploads (Phase 6.1) ---
  // Where re-encoded images are written by the local-disk driver. Must sit
  // outside the served source tree; nothing maps it as a web root, and bytes
  // only leave through the media route. Swapped for R2 later.
  //
  // In production this must be an ABSOLUTE path onto a mounted volume. A
  // container's own filesystem is thrown away on every redeploy, so a relative
  // default would lose every cover and avatar the next time main is merged —
  // a data-loss bug that no test can see because it needs two deploys to show
  // up. See DEPLOY.md; the deployed value is /data/uploads.
  UPLOAD_DIR: z.string().default("./var/uploads"),
  // Hard ceiling on an accepted upload, enforced while reading the request so
  // an oversized body is refused mid-stream rather than buffered whole.
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  // Longest edge kept on re-encode; larger images are scaled down (never up).
  UPLOAD_MAX_DIMENSION: z.coerce.number().int().positive().default(2048),
});

/**
 * Checks that only apply to a real deployment (Phase 7.5).
 *
 * Each of these is a setting whose development default is *convenient* and
 * whose production value is *load-bearing* — exactly the shape of mistake that
 * ships green, because every test runs with NODE_ENV=test and is therefore
 * blind to it. Enforcing them here converts three silent production failures
 * into one readable startup error, alongside the rest of the env contract.
 */
export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;

  // A container filesystem does not survive a redeploy. A relative UPLOAD_DIR
  // resolves inside it, so every cover and avatar would vanish on the next
  // merge to main — and the app would keep serving 404s for rows that still
  // hold a URL. Production must point this at a mounted volume.
  if (!isAbsolutePosixOrWindowsPath(env.UPLOAD_DIR)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["UPLOAD_DIR"],
      message:
        "must be an absolute path onto a persistent volume in production " +
        "(e.g. /data/uploads) — a relative path lives inside the container " +
        "and is discarded on every redeploy",
    });
  }

  // Strict CORS is a Phase-7 requirement, and the default origin list is the
  // three local dev servers. Shipping that would let a page served from a
  // developer's laptop drive a production session. Every deployed origin is
  // https:// in any case: the refresh cookie is Secure, so an http origin
  // could not complete a login even if it were allowed.
  const insecure = env.CORS_ORIGINS.filter(
    (origin) => !origin.startsWith("https://"),
  );
  if (insecure.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGINS"],
      message:
        `every production origin must be https:// — got ${insecure.join(", ")}. ` +
        "Set this to the deployed web origin(s); the localhost default is a " +
        "development convenience.",
    });
  }

  if (env.JWT_SECRET === PLACEHOLDER_JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message:
        "is still the .env.example placeholder — generate a real secret " +
        "(openssl rand -hex 32)",
    });
  }
});

/** True for `/data/uploads` and `C:\data\uploads`, false for `./var/uploads`. */
function isAbsolutePosixOrWindowsPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export type Env = z.infer<typeof envSchema>;

/** Google sign-in is enabled only when the full OAuth client is configured. */
export function isGoogleOAuthEnabled(env: Env): env is Env & {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_CALLBACK_URL: string;
} {
  return Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL,
  );
}

/**
 * Parse and validate the environment, throwing a single readable error that
 * lists every problem at once. Accepts an explicit source to keep it testable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const key = issue.path.join(".") || "(root)";
        return `  - ${key}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Set the missing/invalid variables (see apps/api/.env.example) and retry.`,
    );
  }
  return result.data;
}
