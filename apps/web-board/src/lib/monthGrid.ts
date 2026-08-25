import { intlTag } from "./locale";
/**
 * Month-grid arithmetic for the range picker — everything about *which days a
 * month draws* and nothing about how they are drawn.
 *
 * Split out for the same reason as `timeline.ts` and `fitTabs.ts`: the
 * interesting part is arithmetic over dates, it is worth testing exhaustively,
 * and it is the part that is easy to get quietly wrong.
 *
 * **Everything here speaks `YYYY-MM-DD` and computes in UTC.** A calendar day
 * is not an instant, and the moment you build one with `new Date(y, m, d)` and
 * read it back with local getters you have a value that is one day earlier for
 * half the planet — the same `@db.Date` trap the itinerary hit. Days are
 * compared as strings, which for zero-padded ISO dates is exactly calendar
 * order, and the only `Date` objects are UTC ones used to step the calendar.
 */

/** One cell of a month grid. */
export interface GridDay {
  /** The day it stands for, `YYYY-MM-DD`. */
  readonly iso: string;
  /** Day of the month, for the label. */
  readonly dayOfMonth: number;
  /** False for the leading/trailing days borrowed from the neighbouring month. */
  readonly inMonth: boolean;
}

/** A year and a zero-based month — the cursor the picker scrolls. */
export interface MonthCursor {
  readonly year: number;
  /** Zero-based, as `Date` counts them. */
  readonly month: number;
}

/** Weeks drawn per month. Six always, so the grid never changes height as you
 *  page through it — a control that grows and shrinks under the pointer moves
 *  the day you were about to click. */
const WEEKS = 6;
const DAYS_PER_WEEK = 7;

const pad = (n: number) => String(n).padStart(2, "0");

/** A UTC date as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD` as a UTC midnight `Date`, or null when it is not a day. */
export function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects the impossible dates `Date` silently rolls over ("2026-02-31").
  return isoDay(d) === iso ? d : null;
}

/** The cursor a day belongs to, or today's when it is not a day. */
export function cursorFor(iso: string | null): MonthCursor {
  const d = (iso && parseDay(iso)) || new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** Step a cursor by whole months, rolling the year over in both directions. */
export function addMonths(cursor: MonthCursor, delta: number): MonthCursor {
  const total = cursor.year * 12 + cursor.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * The six-week grid for a month, Monday first.
 *
 * Monday rather than Sunday because the app's audience is European and the
 * trip's own dates are written in that order everywhere else in the UI. The
 * leading and trailing cells are real neighbouring days, not blanks: a range
 * that starts on the 30th and ends on the 2nd has to be selectable and
 * shadeable across the seam.
 */
export function monthGrid(cursor: MonthCursor): GridDay[] {
  const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
  // getUTCDay is 0=Sunday; shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime());
  start.setUTCDate(start.getUTCDate() - lead);

  const days: GridDay[] = [];
  for (let i = 0; i < WEEKS * DAYS_PER_WEEK; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    days.push({
      iso: isoDay(d),
      dayOfMonth: d.getUTCDate(),
      inMonth: d.getUTCMonth() === cursor.month,
    });
  }
  return days;
}

/**
 * Does this day belong to that month?
 *
 * Used to tell a grid's own days from the neighbours it spills into, when the
 * neighbour is a month already drawn beside it. Compared on the ISO string
 * rather than by constructing a Date, because the string's first seven
 * characters *are* the year and month and parsing gains nothing.
 */
export function isInMonth(iso: string, cursor: MonthCursor): boolean {
  const month = String(cursor.month + 1).padStart(2, "0");
  return iso.slice(0, 7) === `${cursor.year}-${month}`;
}

/** The month's name and year, for the grid's caption. */
export function monthLabel(cursor: MonthCursor): string {
  return new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(
    intlTag(),
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

/** Weekday initials, Monday first. */
export function weekdayLabels(): { short: string; long: string }[] {
  // Any Monday will do; 2026-01-05 is one.
  const monday = Date.UTC(2026, 0, 5);
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => {
    const d = new Date(monday + i * 86_400_000);
    return {
      short: d.toLocaleDateString(intlTag(), {
        weekday: "narrow",
        timeZone: "UTC",
      }),
      long: d.toLocaleDateString(intlTag(), {
        weekday: "long",
        timeZone: "UTC",
      }),
    };
  });
}

/** Inclusive containment, on zero-padded ISO days where string order is date order. */
export function within(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

/** How a day sits in the selection — what the cell paints. */
export type DayRole = "none" | "start" | "end" | "between" | "single";

/**
 * Can the next tap lengthen this selection, or will it start a new one?
 *
 * The single fact the whole control turns on, and the reason it needs no state
 * beyond the two days: **a one-day answer is the extendable one**. Nothing
 * chosen cannot be extended (there is no start to extend from), and a range
 * already spanning two different days is not extended either — a tap after a
 * finished range means "start again", which is what stops one stray click
 * editing an end nobody said they meant.
 */
export function extendable(start: string | null, end: string | null): boolean {
  return start !== null && (end === null || end === start);
}

/**
 * A day's place in the range being built, including the **hovered** end.
 *
 * The preview is the whole point of a two-tap range: after the first tap the
 * grid has to show what the range *would* be, or the second tap is a guess. So
 * it previews in exactly the state {@link nextSelection} would extend from, and
 * in no other — a shaded stretch the next click will not produce is worse than
 * no preview at all. A hover *earlier* than the start previews nothing for the
 * same reason: clicking there restarts.
 */
export function dayRole(
  iso: string,
  start: string | null,
  end: string | null,
  hovered: string | null,
): DayRole {
  if (!start) return "none";
  const previewing =
    extendable(start, end) && hovered !== null && hovered > start;
  const finish = previewing ? hovered : (end ?? start);
  if (iso === start && iso === finish) return "single";
  if (iso === start) return "start";
  if (iso === finish) return "end";
  return within(iso, start, finish) ? "between" : "none";
}

/**
 * The next selection after tapping a day — the whole interaction, as a
 * function.
 *
 * **One tap is already an answer**, and that is the change. The grid used to
 * treat the first tap as half of something: it set a start, left the end null,
 * and waited. Which meant a one-day trip — a Saturday, a day return, a single
 * night out — could only be said by tapping the same square twice, and nothing
 * on screen changed when you did, so nobody ever discovered it. The form then
 * turned a single tap away with "Pick both days, or skip this step", which
 * reads as *a one-day trip is not allowed*, and locking such a Dates option was
 * refused outright as NO_DATES for the same reason.
 *
 * So a tap picks a day, and a second tap on a **later** day stretches it. Every
 * other tap starts over. The answer is complete after every single tap, which
 * is what makes one day sayable — and it needs no "pending" flag beside the two
 * days, because {@link extendable} reads that state off them.
 */
export function nextSelection(
  iso: string,
  start: string | null,
  end: string | null,
): { start: string; end: string } {
  if (extendable(start, end) && iso > start!)
    return { start: start!, end: iso };
  return { start: iso, end: iso };
}

/** Keys a date grid answers to, beyond selecting. */
export type GridKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

/**
 * Where a key moves the focused day, or null when the key is not ours.
 *
 * This exists because the two native `<input type="date">`s are gone. They were
 * the typing and keyboard path; with the grid standing alone it has to be
 * operable by keyboard on its own terms, and a calendar's terms are the
 * datepicker convention every OS already uses: arrows by day and week, Home/End
 * to the ends of the week, PageUp/PageDown by month.
 *
 * Pure, and total over the calendar — moving off the displayed month simply
 * returns a day in the next one, and the caller scrolls to follow it. A grid
 * that refused to move past its own edges would make a range crossing a month
 * boundary unreachable, which is the same mistake as drawing the edge cells as
 * blanks.
 */
export function moveFocus(iso: string, key: GridKey): string | null {
  const d = parseDay(iso);
  if (!d) return null;
  const step = (days: number) => {
    const next = new Date(d.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return isoDay(next);
  };
  switch (key) {
    case "ArrowLeft":
      return step(-1);
    case "ArrowRight":
      return step(1);
    case "ArrowUp":
      return step(-7);
    case "ArrowDown":
      return step(7);
    // Monday-first, matching the grid: getUTCDay is 0=Sunday.
    case "Home":
      return step(-((d.getUTCDay() + 6) % 7));
    case "End":
      return step(6 - ((d.getUTCDay() + 6) % 7));
    case "PageUp":
      return shiftMonth(d, -1);
    case "PageDown":
      return shiftMonth(d, 1);
    default:
      return null;
  }
}

/**
 * The same day-of-month one month away, clamped to that month's length.
 *
 * `setUTCMonth` alone rolls 31 March back a month to 3 March, because February
 * has no 31st — a PageUp that lands two months away is a control the reader
 * cannot trust. Clamping gives 28 (or 29) February, which is what every date
 * picker does and what someone paging through months means.
 */
function shiftMonth(d: Date, delta: number): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + delta;
  const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDay(
    new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastOfTarget))),
  );
}
