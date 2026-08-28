import { intlTag } from "./locale";
/**
 * Saying what time of day something is.
 *
 * This has been three controls. `<input type="time">` was a text field wearing
 * a clock — an hour, a minute and often an AM/PM, each typed or nudged
 * separately, and on a phone a three-column drum. Then a quarter-hour
 * `<select>`, on the argument that options here are proposed and voted on
 * rather than timetabled, so a list is enough. That was true of the resolution
 * and wrong about the gesture: a 96-row list is a lot of scrolling to say
 * 19:00, and a quarter-hour grid cannot say 19:20 at all.
 *
 * It is four keys now. Type `1904`, or `19:4`, or `19:04` — {@link
 * parseTypedTime} settles them all to `"19:04"`, and a single digit after the
 * colon pads on the left, because `14:4` means four minutes past and never
 * forty. Twenty-four hours, whatever the reader's clock convention: this is a
 * field you type into, and a field that accepts `1:00 PM` has to decide what
 * `1:00` on its own meant.
 *
 * Everything here still speaks the same `"HH:MM"` string, so the seam with
 * {@link joinDay} and the contract is unchanged.
 */

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
 * How a time reads to this reader: 24-hour where that is the convention,
 * "1:00 PM" where it isn't.
 *
 * The *value* stays `"HH:MM"` either way — only the label is localized, the
 * same split the money fields use. Falls back to the raw value if the runtime
 * has no `Intl` data for the locale, which is better than an empty option.
 */
export function formatTimeOfDay(
  value: string,
  locale: string = intlTag(),
): string {
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

/** What the typed field lets through: digits and one separator. */
const TIME_KEYSTROKES = /[^0-9:]/g;

/**
 * Keep only what could still become a time, as it is being typed.
 *
 * Deliberately permissive — this runs on every keystroke, and a field that
 * refuses a half-finished value is a field you cannot type `19:04` into, since
 * `1`, `19`, `19:` and `19:0` are all on the way there. Rejection happens once,
 * on the way out ({@link parseTypedTime}).
 */
export function sanitizeTypedTime(raw: string): string {
  const kept = raw.replace(TIME_KEYSTROKES, "");
  // Five characters is `HH:MM`; without the colon there are only four digits to
  // be had. The cap used to be five either way, which let `1920` become `19204`
  // — and that is not half-typed, it is unparseable: {@link parseTypedTime}
  // refuses it, the field goes on showing it, and the form keeps the time from
  // before the fifth digit was pressed. Save then writes a time nobody typed.
  return kept.slice(0, kept.includes(":") ? 5 : 4);
}

/**
 * A typed time, settled to `"HH:MM"` — or `null` if it is not a time at all.
 * An empty field is `""`, because "no time" is a real answer here: an option's
 * dates are optional and so is the time on them.
 *
 * The forms it takes, all of which people actually type:
 *
 * - `19:04`, `19:4`, `9:5` — a colon, with each side padded on the **left**.
 *   `14:4` is four minutes past two, never twenty to three; a right-pad would
 *   quietly change what somebody typed into something 36 minutes later.
 * - `1904` — four digits, hour then minute.
 * - `904` — three digits, one hour digit then two minute ones.
 * - `19`, `9` — an hour on its own, on the hour.
 *
 * Out-of-range parts are a rejection, not a wrap: `25:00` and `19:70` are
 * mistakes, and rounding them to something valid would be inventing an answer.
 */
export function parseTypedTime(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "";

  let hours: number;
  let minutes: number;
  if (value.includes(":")) {
    const parts = value.split(":");
    if (parts.length !== 2) return null;
    const [h, m] = parts as [string, string];
    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return null;
    hours = Number(h);
    minutes = Number(m);
  } else {
    if (!/^\d{1,4}$/.test(value)) return null;
    // Minutes are the trailing pair; anything before them is the hour. One or
    // two digits on their own is an hour, on the hour.
    const split = value.length <= 2 ? value.length : value.length - 2;
    hours = Number(value.slice(0, split));
    minutes = value.length <= 2 ? 0 : Number(value.slice(split));
  }
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}
