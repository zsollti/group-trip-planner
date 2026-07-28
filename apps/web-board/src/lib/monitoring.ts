import * as Sentry from "@sentry/react";

/**
 * Browser error reporting (Phase 7.5).
 *
 * Opt-in, exactly like the API side: with no `VITE_SENTRY_DSN` baked into the
 * build the SDK is never initialised and nothing leaves the page. Local
 * development and the test suite therefore run with reporting off and no
 * external dependency, while the deployed bundle reports for real.
 *
 * `VITE_*` values are inlined by Vite at **build** time, so changing the DSN
 * means rebuilding the image — the same constraint that already applies to
 * `VITE_API_URL` (see apps/web-board/Dockerfile). That timing is also what
 * makes the static import below free: with no DSN, Vite inlines `undefined`,
 * the guard becomes statically false, and Rollup drops the entire SDK from the
 * bundle. Measured on this app: 169 kB gzipped without a DSN, 200 kB with one.
 * A dynamic import would buy nothing and would risk missing the errors thrown
 * during the first render, which are the interesting ones.
 */
export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_APP_ENV as string | undefined) ?? "production",
    // Errors only. Session replay and tracing are the expensive parts of the
    // free tier, and neither answers a question this app currently has.
    tracesSampleRate: 0,
    // No IPs, no cookies, no form values. This is the SDK default; it is
    // written out because the value of the default is the privacy posture.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

/**
 * Drop anything that could carry a credential out of the browser.
 *
 * `sendDefaultPii: false` already withholds the obvious channels. The one this
 * app has to be deliberate about is the **URL**: the invite link is
 * `/join/:token` and the verification link is `/verify?token=…`, so a raw
 * request URL in a breadcrumb is a working capability token. Both are stripped
 * from the event's own URL and from every breadcrumb, leaving the route shape
 * — which is all that is needed to find the bug.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) event.request.url = redactTokens(event.request.url);
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.data?.["url"] === "string") {
      crumb.data["url"] = redactTokens(crumb.data["url"]);
    }
  }
  return event;
}

/** Replace invite/verification tokens in a URL with a fixed placeholder. */
function redactTokens(url: string): string {
  return url
    .replace(/\/join\/[^/?#]+/g, "/join/[token]")
    .replace(/([?&]token=)[^&#]*/g, "$1[redacted]");
}
