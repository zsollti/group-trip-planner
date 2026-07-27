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
  if (next) params.set("next", next);
  return `${getApiBaseUrl()}/auth/google?${params.toString()}`;
}
