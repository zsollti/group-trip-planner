/**
 * Sentry initialisation (Phase 7.5).
 *
 * This module must be evaluated **before anything else the process loads** —
 * `main.ts` imports it on its first line, and the production container also
 * passes it to `node --import` so Sentry's ESM loader hooks are registered
 * before the libraries they instrument are resolved. Importing it twice is
 * free: ESM evaluates a module once per resolved URL.
 *
 * Because it runs ahead of Nest, it reads `process.env` directly rather than
 * the validated `Env` — that contract is parsed while AppModule's metadata is
 * built, which is strictly later. The same variables are still declared in
 * `config/env.ts`, so a malformed value fails the normal startup check and the
 * schema stays the single place the environment is documented.
 *
 * Reporting is **opt-in**: with no `SENTRY_DSN` the SDK is never initialised,
 * nothing is sent, and the app behaves exactly as it did before this phase.
 * That keeps local development and CI free of an external dependency.
 */
import * as Sentry from "@sentry/nestjs";

const dsn = process.env.SENTRY_DSN?.trim();

/**
 * Whether error reporting is live. AppModule reads this to decide whether to
 * register the Sentry exception filter, so the wiring matches the SDK state
 * instead of registering a filter that would quietly no-op.
 */
export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // Which build a report came from — it turns a stack trace into a line of
    // source in the repo, and marks the deploy a regression first appeared in.
    // `RAILWAY_GIT_COMMIT_SHA` only exists when a service is wired straight to
    // GitHub; this deployment ships through a CI-gated `railway up` instead
    // (see .github/workflows/deploy.yml), so SENTRY_RELEASE is the value that
    // is actually set, with the Railway variable kept as a fallback in case
    // the service is ever reconnected. Undefined is fine — Sentry groups the
    // events either way, it just cannot link them to source.
    release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    // Errors are the point here. Tracing defaults to off so a busy instance
    // cannot quietly spend the free-tier quota on performance spans; raise it
    // deliberately when there is a latency question worth sampling.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Withholds the user's IP and identity. Note what it does NOT withhold —
    // see scrubEvent.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

/**
 * Strip credentials from an outgoing event. **This is load-bearing, not
 * belt-and-braces** — measured, not assumed.
 *
 * `sendDefaultPii: false` reads like it covers this. It does not. Running the
 * SDK against a local ingest stand-in and throwing inside `POST /auth/login`,
 * with this function disabled, produced an event containing the plaintext
 * `password`, the `Authorization` header, and the refresh cookie — twice, once
 * under `headers` and once under `cookies`. `sendDefaultPii` governs the
 * *user's identity* (IP address, user id); the request envelope around it is
 * attached regardless. Every one of those values is a live credential, and it
 * would have been sitting in a third-party dashboard.
 *
 * Bodies are dropped wholesale rather than filtered by field name: a denylist
 * of key names is a list someone forgets to extend the next time a route takes
 * a secret. What survives — method, path, stack trace — is what actually helps
 * with the bug, as the same stand-in confirmed.
 *
 * This mirrors the redaction the pino logger already applies to the same two
 * headers (see `LoggerModule` in app.module.ts).
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
  }
  return event;
}
