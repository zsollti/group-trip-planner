import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { INestApplication } from "@nestjs/common";
import type { Env } from "../config/env.js";

/**
 * The HTTP edge policy: security headers, cookie parsing, and the CORS lock
 * (Phase 7.2).
 *
 * This lives in its own function rather than inline in `main.ts` so the e2e
 * suite can apply the **same** wiring it ships with. A test that re-declared
 * these headers itself would only be asserting against its own setup; here the
 * production edge and the tested edge are one piece of code.
 *
 * Helmet's defaults are the right shape for a JSON API: HSTS, `nosniff`,
 * `frame-ancestors 'self'` against clickjacking, a `no-referrer` policy, and
 * no `X-Powered-By`. Two notes on what that leaves in place:
 *
 * - The default CSP (`default-src 'self'`, `object-src 'none'`, …) governs the
 *   only HTML this service ever emits — framework error pages — and costs JSON
 *   responses nothing. `GET /media/:name` overrides it with the tighter
 *   `default-src 'none'; sandbox` it has carried since Phase 6.1.
 * - `Cross-Origin-Resource-Policy` stays at helmet's strict `same-origin` for
 *   the API surface. The frontend reads this API through CORS with a Bearer
 *   header, which CORP does not govern, so nothing legitimate needs the relaxed
 *   value. The one route that *is* embedded cross-origin — `/media/:name`,
 *   loaded by `<img>` from the web app's own domain — opts itself out there,
 *   rather than weakening the default for every endpoint.
 */
export function applyHttpHardening(app: INestApplication, env: Env): void {
  app.use(helmet());
  app.use(cookieParser());
  // Credentials are allowed so the httpOnly refresh cookie can flow
  // cross-origin; the origin list is therefore an allowlist, never `*` (the
  // two are mutually exclusive by spec, and CORS_ORIGINS has no wildcard form).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
}
