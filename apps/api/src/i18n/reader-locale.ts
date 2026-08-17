import { resolveLocale, type Locale } from "@gtp/types";

/** Just enough of a request to answer "who is reading this, and in what?" */
interface LocaleBearingRequest {
  /** Attached by `JwtAuthGuard` on an authenticated route. */
  user?: { locale?: string | null } | null;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * The language to answer a request in.
 *
 * Two sources, in order:
 *
 *  1. **the signed-in account.** `JwtAuthGuard` loads the row fresh on every
 *     request, so `user.locale` is the reader's own stored answer;
 *  2. **`Accept-Language`**, which is all there is on the routes that matter
 *     most for a first impression — register, login, verify, the invite preview.
 *     Nobody has an account yet on any of them, and they are exactly where a
 *     wrong-language error message would be least recoverable.
 *
 * The board also sends `Accept-Language` explicitly, set to the language it is
 * *displaying* rather than the one the browser prefers. Those differ for anyone
 * who has chosen a language in the app, and the app's own choice is the one the
 * reader can see.
 *
 * `resolveLocale` narrows both, so a stored value from a later build and a header
 * naming forty languages both degrade to the default rather than failing a
 * request over the wording of its error.
 */
export function readerLocale(req: LocaleBearingRequest | undefined): Locale {
  const fromAccount = req?.user?.locale;
  if (fromAccount) return resolveLocale(fromAccount);

  const header = req?.headers?.["accept-language"];
  return resolveLocale(Array.isArray(header) ? header[0] : header);
}
