/**
 * Where re-encoded images are put (Phase 6.1).
 *
 * The pipeline — size limit, magic-byte check, sharp re-encode, random name —
 * is the security-critical part and is identical wherever the bytes land, so it
 * lives above this seam. Today the only implementation is local disk; the R2
 * one drops in behind the same three methods without the pipeline changing.
 *
 * Uploads are proxied through the API rather than presigned direct-to-bucket
 * precisely so that seam exists: nothing reaches storage without passing the
 * checks first.
 */
export interface StorageDriver {
  /** Store `data` under `name` and return its public URL. */
  put(name: string, data: Buffer, contentType: string): Promise<string>;
  /** Remove a stored object. Missing objects are not an error (idempotent) —
   *  Phase 6.2 leans on this when replacing a cover or avatar. */
  remove(name: string): Promise<void>;
  /** The public URL for an already-stored object. */
  urlFor(name: string): string;
  /**
   * The object name behind one of *our* URLs, or null for anything else.
   *
   * Replacing a cover or avatar (Phase 6.2) has to delete the object it
   * replaced, and the only handle the database keeps is the URL. Returning null
   * for a foreign URL is the safety property: a value that didn't come from
   * this driver can never be turned into a delete.
   */
  nameFromUrl(url: string): string | null;
}

/** DI token — Nest can't inject an interface. */
export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER");
