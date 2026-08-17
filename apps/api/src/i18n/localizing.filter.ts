import { Catch, HttpException, type ArgumentsHost } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { localizedPattern } from "./localized-message.js";
import { interpolate, translate } from "./messages.js";
import { readerLocale } from "./reader-locale.js";

/**
 * Rewrites an exception's message into the reader's language, then hands it on
 * unchanged in every other respect.
 *
 * **Why this is a filter and not an interceptor.** An interceptor is the tidier
 * place — it sees the request, and `catchError` on the stream would need no
 * subclassing at all. But guards run *before* interceptors, and a third of this
 * app's `ForbiddenException`s come from guards (`PermissionGuard`,
 * `VerifiedEmailGuard`, `TripContextGuard`). An interceptor would have quietly
 * translated everything except the permission errors, which are the messages a
 * reader is most likely to meet.
 *
 * **Why it subclasses rather than sits beside the Sentry filter.** Two global
 * filters both matching everything is a question about which one wins that Nest
 * answers by registration order, and getting it wrong is silent in both
 * directions: either the message stops being translated, or exceptions stop being
 * reported. So exactly **one** global filter is registered, and it inherits from
 * whichever base the deployment needs — `SentryGlobalFilter` when Sentry is on,
 * Nest's `BaseExceptionFilter` when it is not. There is no ordering to get wrong
 * because there is nothing to order.
 *
 * Sentry therefore reports the message the reader was actually shown, which is
 * the more useful of the two.
 */
function localize(exception: unknown, host: ArgumentsHost): unknown {
  if (!(exception instanceof HttpException)) return exception;
  // Only HTTP has an Accept-Language header or a `user` on the request; a
  // websocket frame goes to the gateway's own ack path, not here.
  if (host.getType() !== "http") return exception;

  const locale = readerLocale(host.switchToHttp().getRequest());
  const body = exception.getResponse();

  // Nest's shape for `new NotFoundException("Trip not found")` is
  // `{ statusCode, message, error }`. Only the message is ours to change — the
  // status and the error name are protocol, not prose. A validation error carries
  // an *array* of messages instead, and anything else here is a shape this app
  // does not produce; both are left alone rather than guessed at.
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { message?: unknown }).message !== "string"
  ) {
    return exception;
  }

  // What to look up. For a parameterised message that is the **pattern**, never
  // the rendered sentence beside it: "…limit of 12 categories…" is not something
  // any catalogue can hold. Translate first, fill in after.
  const parameterised = localizedPattern(exception);
  const source = parameterised
    ? parameterised.pattern
    : (body as { message: string }).message;

  const translated = translate(source, locale);
  const message = parameterised
    ? interpolate(translated, parameterised.params)
    : translated;

  // Nothing to do for the source language, or for a message with no entry — and
  // saying so by returning the original exception keeps Sentry's view of it, and
  // the response, byte-identical to what they have always been.
  if (message === (body as { message: string }).message) return exception;

  // The same body, one field different. Rebuilding it from scratch is what lost
  // the `error` field the first time this was written.
  return new HttpException({ ...body, message }, exception.getStatus(), {
    cause: exception,
  });
}

/** The filter for a deployment without Sentry. */
@Catch()
export class LocalizingExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(localize(exception, host), host);
  }
}

/** The same, for a deployment with Sentry — reporting included, once. */
@Catch()
export class LocalizingSentryFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(localize(exception, host), host);
  }
}
