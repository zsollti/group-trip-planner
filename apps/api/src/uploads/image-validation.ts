/**
 * Image sniffing (Phase 6.1) — pure, dependency-free, and the first gate every
 * upload passes.
 *
 * The rule is **never trust what the client says**. A browser-supplied
 * `Content-Type` and a filename extension are both attacker-controlled: naming
 * a PHP script `avatar.jpg` and declaring `image/jpeg` costs nothing. So the
 * bytes decide, and the declared type only gets to agree or be rejected.
 *
 * This is deliberately separate from the re-encode step so it can be unit-tested
 * without sharp, a filesystem, or a Nest app.
 */

/** The image types we accept for upload. GIF is intentionally absent: we would
 *  have to flatten animation away on re-encode, which is a silent surprise. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Longest signature we inspect, so callers know how few bytes are needed. */
export const MAGIC_BYTES_NEEDED = 12;

function startsWith(buf: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Identify an image by its magic bytes, or `null` when the content is not one
 * of the accepted formats. Signatures:
 *  - JPEG `FF D8 FF`
 *  - PNG  `89 50 4E 47 0D 0A 1A 0A`
 *  - WebP `RIFF ???? WEBP` (container tag at offset 8)
 */
export function sniffImageType(buffer: Buffer): AcceptedImageType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // "RIFF" .... "WEBP" — the four size bytes between the two tags are skipped.
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/** Why an upload was refused — the caller maps these to messages/status codes. */
export type ImageRejection =
  | "EMPTY"
  | "UNSUPPORTED_CONTENT"
  | "DECLARED_TYPE_NOT_ACCEPTED"
  | "DECLARED_TYPE_MISMATCH";

export type ImageCheck =
  | { readonly ok: true; readonly type: AcceptedImageType }
  | { readonly ok: false; readonly reason: ImageRejection };

/**
 * Check an uploaded buffer against its declared content type.
 *
 * The sniffed type is authoritative; the declared one must both be on the
 * allowlist and agree with the bytes. Requiring agreement (rather than quietly
 * believing the bytes) means a mislabelled upload is a loud 400 instead of a
 * file whose stored type differs from what the client thinks it sent.
 *
 * Size is *not* checked here — it is enforced upstream while reading the
 * request, so an oversized body is never fully buffered in the first place.
 */
export function checkImageUpload(
  buffer: Buffer,
  declaredType: string | undefined,
): ImageCheck {
  if (buffer.length === 0) return { ok: false, reason: "EMPTY" };

  const sniffed = sniffImageType(buffer);
  if (!sniffed) return { ok: false, reason: "UNSUPPORTED_CONTENT" };

  const declared = declaredType?.split(";")[0]?.trim().toLowerCase();
  if (
    !declared ||
    !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(declared)
  ) {
    return { ok: false, reason: "DECLARED_TYPE_NOT_ACCEPTED" };
  }
  if (declared !== sniffed) {
    return { ok: false, reason: "DECLARED_TYPE_MISMATCH" };
  }

  return { ok: true, type: sniffed };
}

/**
 * Stored objects are named by the server, never by the client: a random UUID
 * plus the one extension we ever write. This kills path traversal (`../`),
 * collisions, and any chance of a client-chosen name being meaningful to the
 * web server. The matching guard below is what the media route validates
 * against before touching the filesystem.
 */
export const STORED_IMAGE_EXTENSION = "webp";
export const STORED_IMAGE_TYPE = "image/webp";

const STORED_NAME_RE = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${STORED_IMAGE_EXTENSION}$`,
);

/** Whether a name is one this service generated — the only thing it will serve. */
export function isStoredImageName(name: string): boolean {
  return STORED_NAME_RE.test(name);
}
