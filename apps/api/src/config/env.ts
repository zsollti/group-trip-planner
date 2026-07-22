import { z } from "zod";

/**
 * Startup environment contract (Phase 0.5).
 *
 * Every value the API needs from the environment is declared here and parsed
 * once at boot. Optional values carry sane defaults; anything the app cannot
 * run without (currently just DATABASE_URL) is required, so a misconfigured
 * deployment fails fast at startup instead of erroring on the first request.
 */
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
});

export type Env = z.infer<typeof envSchema>;

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
