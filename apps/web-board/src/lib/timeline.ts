import { useCallback, useState } from "react";
import {
  isOutsideTripDates,
  type CategoryView,
  type OptionView,
  type TripDateRange,
} from "@gtp/types";

/**
 * The itinerary view's layout core — everything about *where* a decision lands
 * on the trip's calendar, and nothing about how it is drawn. (The one exception
 * is the view preference at the bottom, which follows `laneSort.ts`.)
 *
 * Split out for the same reason as `fitTabs.ts`: the interesting part is
 * arithmetic over dates and it is worth testing exhaustively, while the part
 * that draws it is trivial and jsdom cannot measure it anyway.
 *
 * Two rules carry most of the design:
 *
 *  - **An option's dates are instants and the trip's are calendar dates**, and
 *    they are read with different getters *because they are different types*.
 *    `Trip.startDate`/`endDate` are Postgres `date` columns, so they arrive as
 *    midnight UTC and carry no zone at all — read with local getters they slide
 *    to the previous day everywhere west of Greenwich, which is most of the
 *    Americas. An option's `startsAt` is a genuine instant and *must* be read
 *    locally, or a 07:15 flight drifts by hours depending on who is looking.
 *    Both mistakes look correct in whichever zone you happen to develop in.
 *  - **A span is anything that crosses a local midnight**, derived rather than
 *    read off the category. Hard-coding "Accommodation is a span" repeats the
 *    mistake the `singleChoice` seed made: whether a lane holds overnight things
 *    is a property of what the trip put in it, not of the word at the top. A
 *    five-day car rental in a custom lane is a span; a museum is not; and an
 *    overnight train is one too, which is the right answer — the gutter asks
 *    "where am I sleeping" and "on a train" is a real reply.
 */

/**
 * Longest axis this will draw.
 *
 * Only reachable on a **derived** axis, where a single mistyped year would
 * otherwise ask the browser to lay out a few thousand day rows. Once the trip's
 * dates are settled the server's planning horizon bounds the range and
 * {@link isOutsideTripDates} sweeps up the far-away options before they can
 * stretch anything.
 */
export const MAX_TIMELINE_DAYS = 400;

/** Local midnight of the day containing `ms` — local, deliberately. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day as `YYYY-MM-DD`. The identity a day row is keyed by. */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The calendar day a **trip** date names, as `YYYY-MM-DD`.
 *
 * UTC getters, unlike everything else here: `Trip.startDate` is a Postgres
 * `date`, so Prisma hands back midnight UTC for a value that was never an
 * instant in the first place. `toLocaleDateString` on it — which is what the
 * trip header still does — renders the day before across the Americas.
 */
export function tripDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * A `YYYY-MM-DD` as local midnight of that same calendar day.
 *
 * The bridge between the two conventions: it takes the day a trip date *names*
 * and returns the instant the spine's day rows are built from, so a trip's
 * "Jul 3" and an option at 07:15 on Jul 3 land on one row for every reader.
 */
export function calendarDayToLocalMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** One option placed on the calendar, with its dates already resolved to ms. */
export interface TimelineEntry {
  readonly option: OptionView;
  readonly category: CategoryView;
  /** Instant it begins. */
  readonly start: number;
  /** Instant it ends; equal to {@link start} when only one date was given. */
  readonly end: number;
  /** Only one date was given, so this is a moment rather than an interval. */
  readonly isPoint: boolean;
}

/** An entry that crosses at least one local midnight — drawn in the gutter. */
export interface TimelineSpan extends TimelineEntry {
  readonly firstDay: string;
  readonly lastDay: string;
  /** Local midnights crossed: a Fri 15:00 → Mon 10:00 stay is 3 nights. */
  readonly nights: number;
}

/** One row of the spine. */
export interface TimelineDay {
  readonly key: string;
  /** Local midnight, for the heading's own formatting. */
  readonly at: number;
  /** An overhang day — placed entries reach it, the trip's range does not. */
  readonly outsideTrip: boolean;
  /** Moments starting on this day, earliest first. */
  readonly entries: readonly TimelineEntry[];
}

/**
 * Where the day range came from. `"trip"` is the settled range (the frame the
 * page is really about), `"derived"` is the min/max of the options themselves —
 * honest but unstable, since it moves whenever anyone adds a date.
 */
export type TimelineAxis = "trip" | "derived" | "none";

export interface Timeline {
  readonly axis: TimelineAxis;
  readonly days: readonly TimelineDay[];
  readonly spans: readonly TimelineSpan[];
  /** Carries no date at all, so there is nowhere to put it. Never dropped. */
  readonly unscheduled: readonly TimelineEntry[];
  /** Dated, but {@link isOutsideTripDates} says it is not on this trip. */
  readonly elsewhere: readonly TimelineEntry[];
  /** Entries actually on the spine — spans plus moments. */
  readonly placedCount: number;
  /** The axis hit {@link MAX_TIMELINE_DAYS} and was cut short. */
  readonly truncated: boolean;
}

/** An option/category pair before its dates have been looked at. */
export interface TimelineCandidate {
  readonly option: OptionView;
  readonly category: CategoryView;
}

/**
 * The options this view considers, flattened out of the board's per-category
 * map.
 *
 * The Dates category is **excluded on purpose**: its locked option is not an
 * event within the trip, it *is* the trip — locking it writes the very
 * `startDate`/`endDate` this page uses as its frame. Drawing it as a bar
 * spanning the whole axis would restate the axis.
 */
export function timelineCandidates(
  categories: readonly CategoryView[],
  optionsByCategory: Record<string, OptionView[]>,
  { includeProposed = false }: { includeProposed?: boolean } = {},
): TimelineCandidate[] {
  const out: TimelineCandidate[] = [];
  for (const category of categories) {
    if (category.builtinKey === "DATES") continue;
    for (const option of optionsByCategory[category.id] ?? []) {
      if (option.status !== "LOCKED" && !includeProposed) continue;
      out.push({ option, category });
    }
  }
  return out;
}

/** Resolve an option's dates to instants, or null when it carries none. */
function resolveDates(
  option: OptionView,
): { start: number; end: number; isPoint: boolean } | null {
  const rawStart = option.startsAt ? Date.parse(option.startsAt) : NaN;
  const rawEnd = option.endsAt ? Date.parse(option.endsAt) : NaN;
  const hasStart = !Number.isNaN(rawStart);
  const hasEnd = !Number.isNaN(rawEnd);
  if (!hasStart && !hasEnd) return null;
  // One end alone bounds both sides — the same reading `isOutsideTripDates`
  // takes, so the two never disagree about what an option covers.
  const start = hasStart ? rawStart : rawEnd;
  const end = hasEnd ? rawEnd : rawStart;
  // A backwards pair is not worth a special case: swap it so it still draws.
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    isPoint: !hasStart || !hasEnd,
  };
}

/** Local calendar days from `fromMs` to `toMs` inclusive, capped. */
function eachLocalDay(
  fromMs: number,
  toMs: number,
): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  const cursor = new Date(startOfLocalDay(fromMs));
  const last = startOfLocalDay(toMs);
  while (cursor.getTime() <= last && out.length < MAX_TIMELINE_DAYS) {
    out.push({ key: localDayKey(cursor.getTime()), at: cursor.getTime() });
    cursor.setDate(cursor.getDate() + 1);
    // A DST boundary moves the clock, not the date — re-pin to midnight so the
    // walk cannot drift an hour a day and eventually skip or repeat one.
    cursor.setHours(0, 0, 0, 0);
  }
  return out;
}

/**
 * Lay the given options out against the trip's calendar.
 *
 * Nothing is silently discarded: an option with no dates lands in
 * {@link Timeline.unscheduled} and one the trip's range disowns lands in
 * {@link Timeline.elsewhere}, both of which the page shows. A view that quietly
 * drew three of eight decisions would be read as "this is the trip".
 *
 * The axis is the trip's settled range when it has one, widened to reach any
 * entry that overhangs it. The overhang is real and legitimate — a red-eye home
 * lands the morning after the last day — so those days are kept and flagged
 * ({@link TimelineDay.outsideTrip}) rather than clipped, which would hide the
 * flight, or allowed to stretch the axis, which happens anyway only within the
 * day of slack `isOutsideTripDates` already tolerates.
 */
export function buildTimeline(
  candidates: readonly TimelineCandidate[],
  tripDates: TripDateRange | null,
): Timeline {
  const unscheduled: TimelineEntry[] = [];
  const elsewhere: TimelineEntry[] = [];
  const placed: TimelineEntry[] = [];

  for (const { option, category } of candidates) {
    // The trays are about **decisions**. A locked option the page cannot place
    // is an omission worth confessing — the trip really did decide it and the
    // itinerary really is missing it. An undated *proposal* is neither: it is a
    // candidate on an opt-in overlay, and listing every one of them under "not
    // on the timeline" would bury the handful that actually need a date.
    const decided = option.status === "LOCKED";
    const dates = resolveDates(option);
    if (!dates) {
      if (decided) {
        unscheduled.push({ option, category, start: 0, end: 0, isPoint: true });
      }
      continue;
    }
    const entry: TimelineEntry = { option, category, ...dates };
    if (isOutsideTripDates(option, tripDates)) {
      if (decided) elsewhere.push(entry);
    } else placed.push(entry);
  }

  const spans: TimelineSpan[] = [];
  const moments: TimelineEntry[] = [];
  for (const entry of placed) {
    const firstDay = localDayKey(entry.start);
    const lastDay = localDayKey(entry.end);
    if (firstDay === lastDay) {
      moments.push(entry);
      continue;
    }
    spans.push({
      ...entry,
      firstDay,
      lastDay,
      nights: eachLocalDay(entry.start, entry.end).length - 1,
    });
  }

  // The frame, then whatever overhangs it.
  const tripFirstDay = tripDates ? tripDayKey(tripDates.startDate) : null;
  const tripLastDay = tripDates ? tripDayKey(tripDates.endDate) : null;

  let axis: TimelineAxis = "none";
  let from: number | null = null;
  let to: number | null = null;
  if (tripFirstDay !== null && tripLastDay !== null) {
    // Local midnight of the day the trip *names*, so its frame and an option's
    // wall-clock instant end up on the same row.
    from = calendarDayToLocalMs(tripFirstDay);
    to = calendarDayToLocalMs(tripLastDay);
    if (from !== null && to !== null) axis = "trip";
  }
  for (const entry of placed) {
    from = from === null ? entry.start : Math.min(from, entry.start);
    to = to === null ? entry.end : Math.max(to, entry.end);
  }
  if (axis === "none" && from !== null) axis = "derived";

  const raw = from === null || to === null ? [] : eachLocalDay(from, to);
  const byDay = new Map<string, TimelineEntry[]>();
  for (const entry of moments) {
    const key = localDayKey(entry.start);
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  }
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        a.start - b.start || a.option.title.localeCompare(b.option.title),
    );
  }

  const days: TimelineDay[] = raw.map((d) => ({
    key: d.key,
    at: d.at,
    outsideTrip:
      tripFirstDay !== null &&
      tripLastDay !== null &&
      (d.key < tripFirstDay || d.key > tripLastDay),
    entries: byDay.get(d.key) ?? [],
  }));

  spans.sort((a, b) => a.start - b.start || b.nights - a.nights);

  return {
    axis,
    days,
    spans,
    unscheduled,
    elsewhere,
    placedCount: placed.length,
    truncated: raw.length >= MAX_TIMELINE_DAYS,
  };
}

/**
 * A trip date as the local `Date` a formatter should render.
 *
 * Goes through the calendar day the value *names*, so `toLocaleDateString`
 * cannot slide it to the previous evening. The trip header still formats these
 * directly and shows the day before across the Americas.
 */
export function tripDateForDisplay(iso: string | null): Date | null {
  if (!iso) return null;
  const key = tripDayKey(iso);
  const ms = key === null ? null : calendarDayToLocalMs(key);
  return ms === null ? null : new Date(ms);
}

/** Index of a day key in the spine, or -1 — how a span finds its grid rows. */
export function dayIndex(days: readonly TimelineDay[], key: string): number {
  return days.findIndex((d) => d.key === key);
}

const PROPOSALS_KEY = "gtp.timeline.showProposals";

/**
 * Whether this reader wants proposals drawn under the itinerary.
 *
 * Persisted per browser, exactly like {@link import("./laneSort").useLaneSort}
 * and for the same reason: it is one person's view of the trip, not something
 * the group agrees on, so it needs no contract and no write path.
 *
 * **Default off, and deliberately not a two-mode switch.** A "Locked / All"
 * toggle would imply two equal views and make you choose a mode before
 * understanding either. Locked options *are* the timeline; proposals are an
 * overlay you can turn on to spot a clash, drawn subordinate so they can never
 * be mistaken for the plan. In a multi-select lane with six candidates, all six
 * land on overlapping slots and at most one of them will happen — that is
 * useful while deciding and actively misleading as a schedule.
 */
export function useTimelineProposals(): [boolean, (next: boolean) => void] {
  const [show, setShowState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PROPOSALS_KEY) === "1";
    } catch {
      // Private mode / storage disabled — the default is a fine answer.
      return false;
    }
  });

  const setShow = useCallback((next: boolean) => {
    setShowState(next);
    try {
      window.localStorage.setItem(PROPOSALS_KEY, next ? "1" : "0");
    } catch {
      // Preference just won't survive a reload; not worth surfacing.
    }
  }, []);

  return [show, setShow];
}
