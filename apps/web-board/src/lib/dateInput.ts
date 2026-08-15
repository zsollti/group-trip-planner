import type { OptionDateGranularity } from "@gtp/types";

/**
 * Converting between what a date control speaks and what the contract wants.
 *
 * Two shapes, because there are two questions. `<input type="date">` speaks
 * calendar days ("2026-09-06") and `<input type="datetime-local">` speaks a
 * local wall-clock instant ("2026-09-06T07:15"); the contract speaks ISO
 * instants for both. Which one a field uses is
 * {@link OptionDateGranularity}, decided per category.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A day ("2026-09-06") as the ISO instant the contract wants — pinned to
 * **midday UTC**, not local midnight.
 *
 * A day-granularity date is a calendar day, and the columns it can reach are
 * date-only. Local midnight sent from anywhere east of Greenwich lands on the
 * previous day in UTC and gets truncated to it, so a group in Warsaw would pick
 * the 6th and get the 5th. Midday leaves twelve hours of slack either way,
 * which covers every real offset.
 */
export function dayToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T12:00:00Z`).toISOString();
}

/** A local wall-clock value ("2026-09-06T07:15") as an ISO instant. */
export function minuteToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

/** An ISO instant as a `<input type="date">` value, in the reader's own zone. */
export function isoToDayInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * An ISO instant as a `<input type="datetime-local">` value, in the reader's
 * own zone.
 */
export function isoToMinuteInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${isoToDayInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Read a stored instant into a control of the given granularity.
 *
 * Deliberately **local** getters even for a day: a value stored at midday UTC
 * reads back as the same calendar day everywhere, and one stored by the old
 * datetime-local form at local midnight would read back as the *previous* day
 * under UTC getters. Local is right for both.
 */
export function toDateInput(
  iso: string | null,
  granularity: OptionDateGranularity,
): string {
  return granularity === "day" ? isoToDayInput(iso) : isoToMinuteInput(iso);
}

/** Shape a control's value for the contract, by granularity. */
export function fromDateInput(
  value: string,
  granularity: OptionDateGranularity,
): string | undefined {
  return granularity === "day" ? dayToIso(value) : minuteToIso(value);
}

/**
 * Split a control's value into the calendar day and the time of day.
 *
 * The range picker works in whole days for both granularities — a grid of
 * squares has nowhere to put 07:15 — so a minute-granularity field is a day
 * chosen on the grid plus a time typed beside it. This is the seam between
 * them, and it is pure string surgery on a fixed-width format rather than a
 * parse, so no timezone gets a chance to move the day.
 */
export function splitDay(value: string): { day: string; time: string } {
  return { day: value.slice(0, 10), time: value.slice(11, 16) };
}

/**
 * Put a day and a time back together for a control of the given granularity.
 *
 * A day with no time yet defaults to **midnight** rather than staying blank:
 * the grid's whole job is that picking two days is enough, and a value the form
 * then drops because its time half is empty would make the picker a decoration.
 * A time with no day is nothing — there is no instant in "07:15".
 */
export function joinDay(
  day: string,
  time: string,
  granularity: OptionDateGranularity,
): string {
  if (!day) return "";
  if (granularity === "day") return day;
  return `${day}T${time || "00:00"}`;
}
