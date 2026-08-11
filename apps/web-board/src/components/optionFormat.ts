import type { OptionDateGranularity, OptionView } from "@gtp/types";
import { formatMoney } from "../lib/money";

/**
 * Compact money label for an option card — "€480 total", "45 000 Ft/person".
 *
 * This used to interpolate the raw number and the bare code: `45000 EUR/person`,
 * six digits nobody can read without counting them, in an app whose cost strip
 * two inches above was already saying `€45,000.00`. Both go through
 * {@link formatMoney} now, so the board has one idea of what money looks like.
 */
export function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${formatMoney(o.amount, o.currency)}${per}`;
}

/**
 * Short date label for a card, formatted to the precision the category
 * captures ({@link OptionDateGranularity}).
 *
 * A `"day"` option shows days alone — "Jul 3 – Jul 10". A `"minute"` one shows
 * the time too, because that is the part worth reading: a flight is not "Jul 6",
 * it is "Jul 6, 07:15". When both ends fall on the same day the date is not
 * repeated ("Jul 6, 07:15 – 11:40"), which is the common case for a transfer or
 * an activity.
 *
 * Everything is formatted in the reader's own locale and zone — the server
 * stores instants and never formats them.
 */
export function dateRangeLabel(
  startsAt: string | null,
  endsAt: string | null,
  granularity: OptionDateGranularity,
): string | null {
  if (!startsAt && !endsAt) return null;
  const day = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  const time = (s: string) =>
    new Date(s).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  const stamp = (s: string) =>
    granularity === "day" ? day(s) : `${day(s)}, ${time(s)}`;

  if (startsAt && endsAt) {
    const sameDay =
      new Date(startsAt).toDateString() === new Date(endsAt).toDateString();
    if (granularity === "minute" && sameDay) {
      return `${stamp(startsAt)} – ${time(endsAt)}`;
    }
    return `${stamp(startsAt)} – ${stamp(endsAt)}`;
  }
  return stamp((startsAt ?? endsAt) as string);
}
