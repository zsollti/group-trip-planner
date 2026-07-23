/**
 * Clamp a `?next=` redirect target to a safe internal path. Prevents open
 * redirects: only same-origin absolute paths are honoured (`/join/…`, `/`),
 * never a protocol-relative (`//evil.com`) or absolute URL. Returns `null` when
 * the value is missing or unsafe, so callers fall back to the home route.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
