import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe tokens (Phase 5.2, FR-36).
 *
 * A **stateless HMAC** rather than a stored token, deliberately: the link has to
 * work from an email client with no session, possibly months later, and a
 * signature needs no row, no expiry sweep, and no lookup. There is nothing to
 * leak beyond the ability to *silence* one user's own notification email — the
 * token grants no read, no write, no login.
 *
 * The payload is the user id; the signature is HMAC-SHA256 over a
 * **purpose-tagged** message, so a token minted here can never be replayed
 * against another HMAC that happens to share `JWT_SECRET`.
 */

/** Domain separation — never reuse a raw secret across two token purposes. */
const PURPOSE = "unsubscribe:v1";

const b64url = (buf: Buffer): string => buf.toString("base64url");

function sign(userId: string, secret: string): string {
  return b64url(
    createHmac("sha256", secret).update(`${PURPOSE}:${userId}`).digest(),
  );
}

/** Mint the token that rides in an unsubscribe link: `<userId>.<signature>`. */
export function createUnsubscribeToken(userId: string, secret: string): string {
  return `${b64url(Buffer.from(userId, "utf8"))}.${sign(userId, secret)}`;
}

/**
 * Recover the user id from a token, or null if it is malformed or the signature
 * does not verify. Comparison is **timing-safe**, so the endpoint cannot be used
 * as an oracle to forge a signature byte by byte.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): string | null {
  const [encodedId, signature] = token.split(".");
  if (!encodedId || !signature) return null;

  let userId: string;
  try {
    userId = Buffer.from(encodedId, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!userId) return null;

  const expected = Buffer.from(sign(userId, secret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? userId : null;
}
