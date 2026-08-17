import type { HttpException } from "@nestjs/common";
import { interpolate } from "./messages.js";

/**
 * How a **parameterised** message reaches the exception filter with its values
 * still separate from its words.
 *
 * Four of this API's messages carry a number or a name — a category cap, an upload
 * limit, a lane's own title. Interpolating those at the throw site destroys the
 * only thing a translator can work from: "This board is at its limit of 12
 * categories" is not a key, and the next board has a different limit. So the
 * pattern and its values travel alongside the finished English sentence, and the
 * filter translates the pattern before filling it in.
 *
 * **The exception itself is an ordinary Nest one**, carrying ordinary English.
 * Two earlier attempts were worse, and the tests said so rather than the design
 * review:
 *
 *  - passing `{ pattern, params }` as the response *body* dropped the `error`
 *    field (Nest builds `{ statusCode, message, error }` from a string body and
 *    passes an object body through untouched) and turned every log line and Sentry
 *    report for these four messages into "Bad Request Exception";
 *  - replacing them with one generic `LocalizedHttpException` fixed the prose but
 *    lost the classification: `instanceof BadRequestException` stopped holding, and
 *    a bare `HttpException("msg", 400)` does not build Nest's body shape either.
 *
 * Stamping a hidden property keeps every property of the real exception — class,
 * status, body shape, message — and adds one thing only the filter looks for. If
 * the filter never runs, the reader gets correct English rather than a raw pattern
 * with braces in it.
 */

/** Non-enumerable, so it cannot leak into a JSON body or a log dump. */
const PATTERN = Symbol("gtp.localizedPattern");

export interface LocalizedPattern {
  /** The source-language pattern, carrying `{placeholders}`. */
  readonly pattern: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/**
 * Throw a Nest exception whose message is a pattern plus values.
 *
 * The factory takes the rendered English, so the pattern is written once and
 * cannot drift from the values it is given:
 *
 * ```ts
 * throw localizedException(
 *   (message) => new ForbiddenException(message),
 *   "This board is at its limit of {cap} categories.",
 *   { cap },
 * );
 * ```
 */
export function localizedException<E extends HttpException>(
  make: (message: string) => E,
  pattern: string,
  params: Readonly<Record<string, string | number>>,
): E {
  const exception = make(interpolate(pattern, params));
  Object.defineProperty(exception, PATTERN, {
    value: { pattern, params } satisfies LocalizedPattern,
    enumerable: false,
    writable: false,
  });
  return exception;
}

/** The pattern behind an exception's message, if it has one. */
export function localizedPattern(exception: unknown): LocalizedPattern | null {
  if (typeof exception !== "object" || exception === null) return null;
  const found = (exception as Record<symbol, unknown>)[PATTERN];
  return (found as LocalizedPattern | undefined) ?? null;
}
