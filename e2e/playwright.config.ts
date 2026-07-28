import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end suite (Phase 7.4).
 *
 * Everything below the browser is already covered: the API has integration
 * suites against a real database, and the board has DOM tests against mocked
 * fetch. What neither can prove is that the two halves fit — that a real bundle,
 * served over a real origin, talking to a real server over CORS and a real
 * WebSocket, carries a group from "no account" to "decision locked". That is the
 * whole remit of this suite, so it stays deliberately small: two journeys, no
 * per-component assertions, nothing that a cheaper test already covers.
 *
 * Both servers are started here rather than assumed, and both are **built
 * first**, so a green run means the shipped artefacts work — not the dev server.
 * There are no screenshot or visual-diff assertions anywhere (a standing project
 * rule); every assertion is behavioural.
 */

const API_PORT = 3100;
const WEB_PORT = 4173;

const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

/**
 * The dev-compose database, unless the environment names another (CI does). The
 * suite writes real rows and cleans up after itself by email prefix.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://gtp:gtp_dev_password@localhost:5432/gtp_dev?schema=public";

const JWT_SECRET = process.env.JWT_SECRET ?? "e2e-only-secret-0123456789abcdef";

export default defineConfig({
  testDir: "./tests",
  // One database, two journeys that both create trips: serial keeps the failure
  // messages honest. The suite is small enough that parallelism buys nothing.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // A browser journey has real timing in it; one retry absorbs a flake without
  // hiding a genuine break, which would fail twice.
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // Build then run the compiled server — the same entry point the container
      // runs in production.
      command:
        "pnpm --filter @gtp/api... run build && pnpm --filter @gtp/api exec node dist/main.js",
      url: `${API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NODE_ENV: "development",
        PORT: String(API_PORT),
        DATABASE_URL,
        JWT_SECRET,
        LOG_LEVEL: "warn",
        // The SPA is a separate origin from the API here, exactly as it will be
        // in production — so CORS is genuinely exercised rather than bypassed.
        CORS_ORIGINS: `${WEB_URL},http://127.0.0.1:${WEB_PORT}`,
        WEB_APP_URL: WEB_URL,
        API_PUBLIC_URL: API_URL,
        // No RESEND_API_KEY: mail is logged, never sent, from a test run.
      },
    },
    {
      command: `pnpm --filter @gtp/web-board... run build && pnpm --filter @gtp/web-board exec vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        // Baked into the bundle at build time (Vite gives an existing process
        // variable priority over any .env file).
        VITE_API_URL: API_URL,
      },
    },
  ],
});
