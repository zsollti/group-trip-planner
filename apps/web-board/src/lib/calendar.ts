import type { TimelineDay, TimelineEntry, TimelineSpan } from "./timeline";
import { dayIndex } from "./timeline";

/**
 * The week-grid layout — days as columns, hours down the side.
 *
 * The vertical spine in `timeline.ts` answers "what happens, in order". This
 * answers the question a spine structurally cannot: **what shape is a day**. A
 * two-hour tram ride and a four-hour trip to Belém are the same box in a list;
 * here one is twice the height of the other, a free morning is visibly free,
 * and two things booked at once sit side by side instead of reading as a
 * sequence.
 *
 * The spine is not replaced. It is still what a phone gets — a week across
 * 390px gives each day about fifty pixels, which is not a calendar, it is a
 * smear — so this is the wide-viewport layout and the two share one core.
 *
 * Everything here is arithmetic over the already-placed entries, which is why
 * it lives beside `timeline.ts` rather than inside the component: it is the
 * part worth testing exhaustively, and jsdom cannot measure the part that
 * draws it.
 */

/** A block that has to be visible and clickable even with no duration. */
export const MIN_BLOCK_MINUTES = 30;

/** The window the grid always shows, before it is widened to fit the day. */
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 22;

/** One timed entry, positioned within its day column. */
export interface CalendarPlacement {
  readonly entry: TimelineEntry;
  /** Minutes from the grid's first hour to the top of the block. */
  readonly topMinutes: number;
  /** Height in minutes — never below {@link MIN_BLOCK_MINUTES}. */
  readonly heightMinutes: number;
  /** Which sub-column this block sits in, when things overlap. */
  readonly lane: number;
  /** How many sub-columns its overlapping group needs. */
  readonly laneCount: number;
}

/** One day column. */
export interface CalendarDay {
  readonly key: string;
  readonly at: number;
  readonly outsideTrip: boolean;
  readonly placements: readonly CalendarPlacement[];
}

/** A span, as a bar in the all-day band above the grid. */
export interface CalendarBand {
  readonly span: TimelineSpan;
  /** Zero-based column indices, inclusive. */
  readonly fromIndex: number;
  readonly toIndex: number;
  /** Which row of the band it sits in, so overlapping stays never cover. */
  readonly row: number;
}

export interface CalendarGrid {
  readonly days: readonly CalendarDay[];
  readonly bands: readonly CalendarBand[];
  /** Rows the all-day band needs; 0 when the trip has no spans. */
  readonly bandRows: number;
  /** First hour drawn, inclusive. */
  readonly startHour: number;
  /** Last hour drawn, exclusive — so 22 means the 21:00 row is the last. */
  readonly endHour: number;
}

const MINUTES_PER_HOUR = 60;

/** Local minutes past midnight of the day `ms` falls in. */
function minutesIntoDay(ms: number, dayStart: number): number {
  return Math.round((ms - dayStart) / 60_000);
}

/**
 * The hours worth drawing.
 *
 * A fixed 00:00–24:00 grid spends two thirds of its height on the hours nobody
 * schedules anything in, which pushes a normal day's events into a strip too
 * short to read. So the default window is the waking day, widened — never
 * narrowed — to contain whatever the trip actually put outside it. A 07:15
 * flight pulls the top to 07:00; a dinner running to 22:30 pushes the bottom to
 * 23:00. Nothing is ever cropped out of view.
 */
export function hourWindow(days: readonly TimelineDay[]): {
  startHour: number;
  endHour: number;
} {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;

  for (const day of days) {
    for (const entry of day.entries) {
      const from = minutesIntoDay(entry.start, day.at);
      // A point has no end, but it still needs room to be drawn.
      const to = entry.isPoint
        ? from + MIN_BLOCK_MINUTES
        : Math.max(minutesIntoDay(entry.end, day.at), from + MIN_BLOCK_MINUTES);
      start = Math.min(start, Math.floor(from / MINUTES_PER_HOUR));
      end = Math.max(end, Math.ceil(to / MINUTES_PER_HOUR));
    }
  }

  return {
    startHour: Math.max(0, Math.min(start, DEFAULT_START_HOUR)),
    endHour: Math.min(24, Math.max(end, DEFAULT_END_HOUR)),
  };
}

/**
 * Side-by-side columns for things booked at the same time.
 *
 * Without this a 10:00 museum drawn over a 10:00 tour hides it completely, and
 * the page would be lying by omission — worse than a list, which at least shows
 * both. The rule is the one every calendar uses: walk the day in start order,
 * put each entry in the leftmost column whose last entry has already finished,
 * and let the widest simultaneous group decide how many columns that group
 * splits into.
 *
 * `laneCount` is per **group**, not per day: one clash at breakfast should not
 * halve the width of an otherwise clear afternoon.
 */
function assignLanes(
  entries: readonly TimelineEntry[],
  dayStart: number,
): CalendarPlacement[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const out: CalendarPlacement[] = [];

  // One group at a time: entries that form a connected run of overlaps.
  let group: { entry: TimelineEntry; lane: number; end: number }[] = [];
  let groupEnd = -Infinity;
  const laneEnds: number[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const laneCount = Math.max(...group.map((g) => g.lane)) + 1;
    for (const g of group) {
      const top = minutesIntoDay(g.entry.start, dayStart);
      out.push({
        entry: g.entry,
        topMinutes: top,
        heightMinutes: Math.max(
          MIN_BLOCK_MINUTES,
          minutesIntoDay(g.end, dayStart) - top,
        ),
        lane: g.lane,
        laneCount,
      });
    }
    group = [];
    laneEnds.length = 0;
    groupEnd = -Infinity;
  };

  for (const entry of sorted) {
    const start = entry.start;
    const end = entry.isPoint
      ? start + MIN_BLOCK_MINUTES * 60_000
      : Math.max(entry.end, start + MIN_BLOCK_MINUTES * 60_000);

    // A gap: nothing left running, so the next entry starts a fresh group and
    // gets the full column width back.
    if (start >= groupEnd) flush();

    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    group.push({ entry, lane, end });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();

  return out;
}

/**
 * Stack the all-day bars so two overlapping stays never cover one another.
 *
 * Greedy by start day, which is enough: bars are few and a trip's stays are
 * mostly consecutive. Sorting by start keeps the visual order the same as the
 * order they happen in, which a purely-densest packing would not.
 */
function assignBandRows(
  spans: readonly TimelineSpan[],
  days: readonly TimelineDay[],
): CalendarBand[] {
  const placed: CalendarBand[] = [];
  // Last column each row reaches, so a later bar can reuse a finished row.
  const rowEnds: number[] = [];

  const ordered = [...spans].sort((a, b) =>
    a.firstDay === b.firstDay
      ? a.lastDay.localeCompare(b.lastDay)
      : a.firstDay.localeCompare(b.firstDay),
  );

  for (const span of ordered) {
    // Clamped rather than trusted, the same guard the spine's gutter uses: a
    // -1 here would place a bar at column 0 and misalign every bar after it.
    const fromIndex = Math.max(0, dayIndex(days, span.firstDay));
    const toIndex = Math.max(fromIndex, dayIndex(days, span.lastDay));

    let row = rowEnds.findIndex((end) => end < fromIndex);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(toIndex);
    } else {
      rowEnds[row] = toIndex;
    }
    placed.push({ span, fromIndex, toIndex, row });
  }

  return placed;
}

/** Lay a timeline out as a week grid. Pure. */
export function buildCalendar(
  days: readonly TimelineDay[],
  spans: readonly TimelineSpan[],
): CalendarGrid {
  const { startHour, endHour } = hourWindow(days);
  const offset = startHour * MINUTES_PER_HOUR;

  const laidOut: CalendarDay[] = days.map((day) => ({
    key: day.key,
    at: day.at,
    outsideTrip: day.outsideTrip,
    placements: assignLanes(day.entries, day.at).map((p) => ({
      ...p,
      topMinutes: p.topMinutes - offset,
    })),
  }));

  const bands = assignBandRows(spans, days);

  return {
    days: laidOut,
    bands,
    bandRows: bands.reduce((n, b) => Math.max(n, b.row + 1), 0),
    startHour,
    endHour,
  };
}

/** The hour labels down the side, as whole hours. */
export function hourLabels(grid: CalendarGrid): number[] {
  const out: number[] = [];
  for (let h = grid.startHour; h < grid.endHour; h += 1) out.push(h);
  return out;
}
