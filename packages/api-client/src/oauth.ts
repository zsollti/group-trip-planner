import { getApiBaseUrl } from "./http.js";

/**
 * Full-page URL that begins Google sign-in (Phase 1.0). It carries the current
 * app's origin as `?redirect=` so the API's OAuth callback returns the browser
 * to *this* front-end (deck/feed/board) — validated server-side against the CORS
 * allowlist. Navigate to it with `window.location.href = googleSignInUrl()`
 * (a normal navigation, not fetch — this leaves the SPA and comes back).
 */
export function googleSignInUrl(): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${getApiBaseUrl()}/auth/google?redirect=${encodeURIComponent(origin)}`;
}
