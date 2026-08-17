import {
  maxTripHorizonDays,
  planLockedDates,
  type LockDatesRejection,
} from "@gtp/types";
import { dayToIso } from "./dateInput";
import { t } from "./i18n";

/**
 * Whether the create form's date answer is usable, checked as it is given.
 *
 * The dates were only ever validated by the server, at the end: they are held
 * outside the form resolver (the calendar speaks `YYYY-MM-DD`, the contract
 * speaks ISO instants) and shaped at submit, so nothing looked at them until
 * the final "Create board". A start with no end — the obvious way to answer a
 * calendar and move on — was accepted by two more steps and then rejected with
 * a message about a question the reader had stopped thinking about.
 *
 * **It runs the same rule the server runs.** `planLockedDates` is the shared
 * pure function trip creation is checked against, so this cannot drift into
 * accepting something the API will refuse, or refusing something it would take.
 * Only the wording is local: the server's phrasing is about *locking* a Dates
 * option, which is what the same rejection means in the other place it is
 * raised, and is nonsense on a form that has not created a trip yet.
 */

/**
 * What each rejection means while answering "when?".
 *
 * `Record<LockDatesRejection, string>` on purpose: a new rejection reason added
 * to the shared union stops compiling here until someone decides how to say it,
 * which is the whole reason to reuse the union rather than copy the checks.
 */
const WHY: Record<LockDatesRejection, string> = {
  NO_DATES: t("Pick both days, or skip this step."),
  END_BEFORE_START: t("The last day can't come before the first."),
  PAST: t("That start date has already passed."),
  OVER_HORIZON: t("That's further ahead than a trip can be planned."),
};

/**
 * The problem with this date answer, or null when there is none.
 *
 * Empty is not a problem — the step is optional, and a form that complained
 * about an unanswered optional question would be refusing to let it be skipped.
 */
export function tripDateStepError(
  startDay: string,
  endDay: string,
  nowMs: number = Date.now(),
): string | null {
  if (!startDay && !endDay) return null;
  if (!startDay || !endDay) return WHY.NO_DATES;

  const plan = planLockedDates(
    dayToIso(startDay) ?? null,
    dayToIso(endDay) ?? null,
    nowMs,
    maxTripHorizonDays(),
  );
  return plan.ok ? null : WHY[plan.reason];
}
