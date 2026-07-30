import { getApiBaseUrl } from "./http.js";

/**
 * Full-page URL that begins Google sign-in (Phase 1.0). It carries the current
 * app's origin as `?redirect=` so the API's OAuth callback returns the browser
 * to *this* front-end (deck/feed/board), and the caller's post-auth destination
 * as `?next=` so a logged-out invite (`/join/:token`) survives the round-trip
 * the same way it does for email/password sign-in. Both are validated
 * server-side — the origin against the CORS allowlist, the path clamped to a
 * same-site absolute path. Navigate with
 * `window.location.href = googleSignInUrl(next)` (a normal navigation, not
 * fetch — this leaves the SPA and comes back).
 */
export function googleSignInUrl(next?: string | null): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({ redirect: origin });
  params.set("next", withReturnMarker(next ?? "/"));
  return `${getApiBaseUrl()}/auth/google?${params.toString()}`;
}

/**
 * Query parameter the OAuth return path carries, naming the provider the browser
 * has just come back from.
 *
 * It exists so a *failure* can be seen. The callback delivers the session as an
 * httpOnly cookie on the **API** origin and the SPA trades it for an access token
 * with a cross-site `POST /auth/refresh`. When a browser declines to send that
 * cookie — every iOS browser blocks third-party cookies, so this happens whenever
 * the API sits on a different registrable domain than the app — the refresh 401s,
 * the route guard bounces to the sign-in card, and the user sees a login page with
 * no hint that anything failed. This marker is what lets that page say so.
 *
 * It is a provider name, never a credential: no token has ever ridden the URL.
 */
export const OAUTH_RETURN_MARKER = "signedin";

/** The marker's value for Google sign-in. */
export const OAUTH_RETURN_GOOGLE = "google";

/**
 * `path` with the return marker added, preserving any query it already carries
 * (an invite's `next` may have one). Parsed against a throwaway base so a
 * relative path can go through `URL`, then re-serialized path-only — the API
 * clamps the value to a same-site absolute path either way.
 */
function withReturnMarker(path: string): string {
  try {
    const url = new URL(path, "http://return.invalid");
    url.searchParams.set(OAUTH_RETURN_MARKER, OAUTH_RETURN_GOOGLE);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Unparseable; the server falls back to the app root anyway.
    return path;
  }
}
