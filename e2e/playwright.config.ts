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
 * Point the journeys at an already-running frontend instead of starting
 * `vite preview` (Phase 7.5).
 *
 * The reason this exists: `vite preview` sends no security headers, so the
 * Content-Security-Policy the production image actually serves — from
 * `apps/web-board/Caddyfile` — is invisible to this suite. A CSP mistake is a
 * completely silent class of bug in every test we have, and shows up only in a
 * real browser against the real container, which is precisely the gap Phase 7.2
 * recorded and deferred to here.
 *
 * So: build and run the deploy image, then re-run these journeys against it.
 *
 *   docker build -f apps/web-board/Dockerfile \
 *     --build-arg VITE_API_URL=http://localhost:3100 -t gtp-web-board .
 *   docker run -d -p 4173:80 --name gtp-board \
 *     -e API_ORIGIN=http://localhost:3100 -e API_WS_ORIGIN=ws://localhost:3100 \
 *     gtp-web-board
 *   E2E_WEB_URL=http://localhost:4173 pnpm --filter @gtp/e2e run test:e2e
 *
 * CI keeps using `vite preview`: it already builds the bundle, and building the
 * image a second time would buy a few minutes of runtime for one header check.
 */
const EXTERNAL_WEB_URL = process.env.E2E_WEB_URL;
const WEB_BASE_URL = EXTERNAL_WEB_URL ?? WEB_URL;

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
    baseURL: WEB_BASE_URL,
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
        CORS_ORIGINS: `${WEB_BASE_URL},http://127.0.0.1:${WEB_PORT}`,
        WEB_APP_URL: WEB_BASE_URL,
        API_PUBLIC_URL: API_URL,
        // No RESEND_API_KEY: mail is logged, never sent, from a test run.
        //
        // **The sign-in limiter is opted out of here, not weakened in the app.**
        // These journeys run serially from one address and sign in a dozen
        // accounts inside a minute, which is precisely the shape the per-IP
        // budget exists to refuse — and it did, as soon as the suite grew past
        // ten. The production numbers stay where they are (see
        // `throttle-policy.ts`); the harness raises them for its own process.
        // The limiter's own behaviour is covered by the API integration suite,
        // which asserts a 429 rather than needing to avoid one.
        REGISTER_THROTTLE_LIMIT: "500",
        LOGIN_THROTTLE_LIMIT: "500",
        // The same opt-out, for the **global floor**, which this file forgot.
        //
        // The floor is 100 a minute keyed on handler *and* address. Every
        // journey here runs from one address and leans on the same few
        // handlers — `GET …/options` most of all, since a board refetches every
        // lane's options after each mutation. The calendar journey spends ~30 of
        // that budget by itself, so several board journeys inside one window
        // (more when a flaky one retries) cross it. That is what turned CI red
        // after #104: the last reads 429'd, the page rendered "Couldn't load the
        // trip's decisions", and a geometry assertion failed as a missing
        // element — a rate limit wearing a layout bug's clothes.
        //
        // Put out of reach rather than tuned to fit today's journey count: the
        // next spec added should not have to know this number exists.
        THROTTLE_LIMIT: "5000",
      },
    },
    // Skipped when E2E_WEB_URL names a frontend that is already running.
    ...(EXTERNAL_WEB_URL
      ? []
      : [
          {
            command: `pnpm --filter @gtp/web-board... run build && pnpm --filter @gtp/web-board exec vite preview --port ${WEB_PORT} --strictPort`,
            url: WEB_URL,
            timeout: 180_000,
            reuseExistingServer: false,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
            env: {
              // Baked into the bundle at build time (Vite gives an existing
              // process variable priority over any .env file).
              VITE_API_URL: API_URL,
            },
          },
        ]),
  ],
});
