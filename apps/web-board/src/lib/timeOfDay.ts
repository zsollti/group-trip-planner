/**
 * Picking a time of day, without a spinner.
 *
 * `<input type="time">` is a text field wearing a clock: it wants an hour, a
 * minute and often an AM/PM, each typed or nudged with an arrow key, and it
 * gives no hint of what a *reasonable* answer looks like. For "when does dinner
 * start" that is a lot of keystrokes to say 19:00, and on a phone it is a
 * three-column drum. Options are proposed and voted on in this app, not
 * timetabled to the minute, so the honest resolution is a quarter of an hour —
 * which turns a free-text field into a short list, and a list can be tapped,
 * typed at, or arrow-keyed with the value visible the whole time.
 *
 * Everything here speaks the same `"HH:MM"` string the time input did, so the
 * seam with {@link joinDay} and the contract is unchanged.
 */

/** The grid the picker offers. A quarter hour — see the note above. */
export const TIME_STEP_MINUTES = 15;

/** Where a new option's span starts if nobody says otherwise. */
export const DEFAULT_START_TIME = "12:00";

/** …and where it ends: an hour later, the length most things default to. */
export const DEFAULT_END_TIME = "13:00";

const pad = (n: number) => String(n).padStart(2, "0");

/** `"HH:MM"` → minutes since midnight, or `null` if it isn't a time. */
export function toMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight → `"HH:MM"`, wrapping at the end of the day. */
export function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/**
 * `value` moved by `delta` minutes, or `null` if it wasn't a time.
 *
 * Wraps rather than clamping, so 23:30 + 1h is 00:30. That is a real answer for
 * an option that runs past midnight, and the alternative — pinning it to 23:59
 * — would quietly invent a different one.
 */
export function shiftTime(value: string, delta: number): string | null {
  const minutes = toMinutes(value);
  return minutes === null ? null : fromMinutes(minutes + delta);
}

/**
 * The choices to offer, given what is currently selected.
 *
 * The quarter-hour grid, plus `current` itself when it falls between two of
 * them — an option saved at 07:20 by the old free-text control, or by anyone
 * editing the URL. Dropping it would silently round somebody's time the moment
 * they opened the form to change an unrelated field, so it is inserted in
 * order and marked off-grid for the caller to label.
 */
export function timeChoices(current: string): string[] {
  const grid: string[] = [];
  for (let m = 0; m < 1440; m += TIME_STEP_MINUTES) grid.push(fromMinutes(m));
  const minutes = toMinutes(current);
  if (minutes === null || minutes % TIME_STEP_MINUTES === 0) return grid;
  const at = Math.floor(minutes / TIME_STEP_MINUTES) + 1;
  return [...grid.slice(0, at), current, ...grid.slice(at)];
}

/**
 * How a time reads to this reader: 24-hour where that is the convention,
 * "1:00 PM" where it isn't.
 *
 * The *value* stays `"HH:MM"` either way — only the label is localized, the
 * same split the money fields use. Falls back to the raw value if the runtime
 * has no `Intl` data for the locale, which is better than an empty option.
 */
export function formatTimeOfDay(value: string, locale?: string): string {
  const minutes = toMinutes(value);
  if (minutes === null) return value;
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return value;
  }
}
