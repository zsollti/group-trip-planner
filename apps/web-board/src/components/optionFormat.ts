import type { OptionDateGranularity, OptionView } from "@gtp/types";
import { intlTag } from "../lib/locale";
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
    new Date(s).toLocaleDateString(intlTag(), {
      month: "short",
      day: "numeric",
    });
  const time = (s: string) =>
    new Date(s).toLocaleTimeString(intlTag(), {
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

/**
 * A link, written the way a person would read it out.
 *
 * `https://www.booking.com/hotel/pt/lisbon-beach.en-gb.html?aid=304142&sid=9f2`
 * is a hundred characters of which about fifteen mean anything, and printing it
 * whole is most of why the detail panel read as a database row: it is the one
 * field on the card with no natural length, and it wrapped over four lines
 * under a heading that said "Link".
 *
 * So: the host, then the path, with the scheme, the `www.`, a trailing slash
 * and the whole query string dropped, and the middle of a very long path
 * elided. **The href is never touched** — this is a label, the full URL stays
 * on `title` and in the anchor, and a reader who wants to check where a link
 * goes has both. Anything that will not parse is returned as it came, which is
 * the honest answer for a string that is not really a URL.
 */
export function linkLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "");
  const whole = host + path;
  if (whole.length <= 44) return whole;
  // Trimmed from the middle: the end of a path is usually the part that names
  // the thing, so cutting only the tail throws away the half worth keeping.
  return `${whole.slice(0, 26)}…${whole.slice(-14)}`;
}
