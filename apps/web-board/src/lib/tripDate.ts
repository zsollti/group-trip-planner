/**
 * Trip dates are calendar days. Option dates are instants. They are not the
 * same kind of value and cannot be read with the same getters.
 *
 * `Trip.startDate`/`endDate` are Postgres `date` columns — a trip runs on days,
 * not on moments — so Prisma hands them back as **midnight UTC** and the mapper
 * serialises exactly that. The zone in the string is an artefact of the
 * transport, not information: the value means "the 3rd of July", full stop.
 * Read it with local getters, or hand it to `toLocaleDateString`, and it slides
 * to the 2nd everywhere west of Greenwich — most of the Americas — because
 * midnight UTC is the previous evening there.
 *
 * An option's `startsAt` is the opposite: a genuine instant, which *must* be
 * read locally or a 07:15 flight drifts by hours depending on who is looking.
 *
 * Both mistakes render correctly in whichever zone you happen to develop in,
 * which is why this is its own module with the rule written down rather than a
 * habit spread across call sites.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day a trip date names, as `YYYY-MM-DD`. UTC getters, on purpose. */
export function tripDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * A `YYYY-MM-DD` as local midnight of that same calendar day.
 *
 * The bridge between the two conventions: it takes the day a trip date *names*
 * and returns an instant inside that day in the reader's own zone, so a trip's
 * "Jul 3" and an option at 07:15 on Jul 3 agree about which day they are on.
 */
export function calendarDayToLocalMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * A trip date as the local `Date` a formatter should render — the one safe way
 * to put `startDate`/`endDate` on screen.
 */
export function tripDateForDisplay(iso: string | null): Date | null {
  if (!iso) return null;
  const key = tripDayKey(iso);
  const ms = key === null ? null : calendarDayToLocalMs(key);
  return ms === null ? null : new Date(ms);
}
