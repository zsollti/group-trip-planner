/**
 * Clamp a `?next=` redirect target to a safe internal path. Prevents open
 * redirects: only same-origin absolute paths are honoured (`/join/…`, `/`),
 * never a protocol-relative (`//evil.com`) or absolute URL. Returns `null` when
 * the value is missing or unsafe, so callers fall back to the home route.
 *
 * The backslash form is rejected too (Phase 7.4). Browsers normalise `\` to `/`
 * while resolving a URL, so `/\evil.com` is another way of writing `//evil.com`.
 * It is not reachable today — every caller hands the result to react-router,
 * which treats it as a pathname and stays on-origin — but the API's mirror of
 * this function (`safeReturnPath`, added with Google sign-in) already rejects it,
 * and two halves of one rule that disagree is how the reachable version arrives
 * later.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}
