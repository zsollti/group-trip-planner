/**
 * How much of an option a calendar block has room to say.
 *
 * A block's height is its duration: a 30-minute coffee gets a sliver and an
 * eight-hour hike gets a column. The old rule was a single boolean — under
 * about 45 minutes, put the title and the time on one line — which meant the
 * eight-hour block said exactly as much as the two-hour one, in a space four
 * times the size.
 *
 * The order is what makes it useful rather than merely fuller. **Cost first,
 * then the note**: the money is the thing being weighed, it is short, and it is
 * the reason someone opens the itinerary at all; the note is why the option is
 * on the list, which matters once you already know what it costs.
 *
 * A rule rather than a set of thresholds sprinkled through the component,
 * because getting it wrong is invisible — a block that could have shown the
 * cost and did not simply looks like an option with no price, which is a
 * different and quite plausible thing.
 */

/** What fits, at a given block height. Each level includes the ones before it. */
export interface CalendarDetail {
  /** Title and time share a line — there is no room for a second. */
  readonly tight: boolean;
  readonly showCost: boolean;
  readonly showNote: boolean;
  /** Lines of the note that fit, once the rest has taken its space. */
  readonly noteLines: number;
}

/**
 * Minutes of block height per line of text, near enough.
 *
 * The calendar's own scale, not a typographic one: the grid draws an hour at a
 * fixed height, and a line of this text occupies roughly a quarter of it. Kept
 * as one number so the thresholds below stay legible as "this many lines".
 */
const MINUTES_PER_LINE = 15;

/** Below this a block cannot hold two lines at all. */
const TIGHT_BELOW = 45;

/**
 * Durations, not line counts, for the two things a block may add.
 *
 * The line arithmetic below decides how many lines *fit*; these decide whether
 * a block is the kind of thing worth putting them on, and the owner set both
 * after reading a real trip on the grid. **An hour for the price, two for the
 * note.** The note in particular had been appearing from 75 minutes, where two
 * lines technically fit and a 90-minute lunch turned into a paragraph in a
 * column of otherwise scannable blocks — fitting and being worth showing are
 * different questions, and only the first one is geometry.
 *
 * Kept as minutes so they can be read against the calendar's own scale (an hour
 * is `--cal-hour` tall) rather than inferred back through `MINUTES_PER_LINE`.
 */
const COST_FROM_MINUTES = 60;
const NOTE_FROM_MINUTES = 120;

export function calendarDetail(heightMinutes: number): CalendarDetail {
  const lines = Math.floor(heightMinutes / MINUTES_PER_LINE);
  const tight = heightMinutes < TIGHT_BELOW;

  // Title and time are one line each once there is room for two; the cost
  // takes the third, and anything past that is the note's.
  const showCost = !tight && heightMinutes >= COST_FROM_MINUTES;
  const spare = lines - (showCost ? 3 : 2);
  // Two lines is the smallest amount of prose worth showing — one line of a
  // note is usually a clause with its verb cut off, which reads as a bug
  // rather than as an excerpt — and two *hours* is the smallest block worth
  // spending them on.
  const showNote = showCost && spare >= 2 && heightMinutes >= NOTE_FROM_MINUTES;

  return {
    tight,
    showCost,
    showNote,
    noteLines: showNote ? Math.min(spare, 4) : 0,
  };
}
