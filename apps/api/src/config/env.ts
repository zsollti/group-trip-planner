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

export const envSchema = z.object({
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
  // Where verification links point (the frontend verify landing, Phase 0.7).
  WEB_APP_URL: z.string().url().default("http://localhost:5173"),

  // --- Rate limiting (global default; auth routes tighten per-route) ---
  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

/** Google sign-in is enabled only when the full OAuth client is configured. */
export function isGoogleOAuthEnabled(
  env: Env,
): env is Env & {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_CALLBACK_URL: string;
} {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_CALLBACK_URL,
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
