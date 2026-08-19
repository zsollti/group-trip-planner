import { ForbiddenException } from "@nestjs/common";
import { banEndDate, banIsActive, type BanFields } from "@gtp/types";
import { localizedException } from "../i18n/localized-message.js";

/**
 * The one place a suspended account is turned away, and the one place the
 * sentence it is turned away with is written.
 *
 * Four callers ask it — sign-in, the Google callback, refresh-token rotation and
 * the per-request guard — because a ban that only closed the front door would be
 * decorative: a live session outlasts it, and a refresh cookie outlasts that.
 *
 * ## Why the message says this much
 *
 * "Forbidden" is what an API says when it does not want to be helpful, and an
 * account that has stopped working with no explanation is the thing this feature
 * exists to prevent rather than to cause. So the reader is told three things: that
 * it is a suspension, when it ends (or that it does not), and why. All three came
 * from the operator, who is the only one who knows any of them.
 *
 * ## Why the date is a bare `YYYY-MM-DD`
 *
 * It is the one rendering that is unambiguous in every language this app speaks
 * and every one it does not. The alternative was formatting it through `Intl` at
 * the throw site, which sounds better and is worse here: {@link localizedException}
 * carries the *pattern* to the exception filter and the filter picks the reader's
 * language, so the sentence around the date is chosen later and elsewhere than
 * the date itself — the two would routinely disagree, giving a Hungarian sentence
 * with an American date in it. A date nobody has to parse beats a date formatted
 * for the wrong reader.
 *
 * ## Why 403 and not 401
 *
 * The credentials were right. Answering 401 would tell someone whose password
 * works that their password does not, and would put the board's silent-refresh
 * retry in front of a message it can never resolve.
 */
export function bannedException(user: BanFields): ForbiddenException {
  const reason = user.banReason ?? "";
  const until = banEndDate(user);
  return until === null
    ? localizedException(
        (message) => new ForbiddenException(message),
        "Your account has been suspended. Reason: {reason}",
        { reason },
      )
    : localizedException(
        (message) => new ForbiddenException(message),
        "Your account is suspended until {date}. Reason: {reason}",
        { date: until, reason },
      );
}

/**
 * Refuse a suspended account, or return quietly.
 *
 * Takes `now` so a test can stand a minute either side of an expiry instead of
 * waiting for one, and passes it straight to the shared {@link banIsActive} —
 * the expiry rule is stated once, in the contract, and read here.
 */
export function assertNotBanned(user: BanFields, now: Date = new Date()): void {
  if (banIsActive(user, now)) throw bannedException(user);
}
