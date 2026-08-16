import { formatTimeOfDay, timeChoices } from "../lib/timeOfDay";

/**
 * A time of day, chosen from a list instead of typed into a clock.
 *
 * Replaces `<input type="time">` on the option form. The old control asked for
 * an hour, a minute and sometimes an AM/PM, each nudged separately, to say
 * something as ordinary as "seven in the evening" — and offered no clue what a
 * plausible answer looked like. Options here are proposed and voted on rather
 * than timetabled, so a quarter of an hour is the honest resolution, and at that
 * resolution the whole day is a list: tappable on a phone, type-ahead on a
 * keyboard ("19" jumps to 19:00), and readable without opening anything.
 *
 * Empty stays a real choice — the dates are optional and so is the time on them.
 *
 * Labels follow the reader's clock convention (24-hour, or 1:00 PM) while the
 * value stays `"HH:MM"`, the same split the money fields use between what is
 * shown and what is sent.
 */
export function TimeSelect({
  id,
  value,
  onChange,
  emptyLabel = "—",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** What the "no time" row reads as. */
  emptyLabel?: string;
}) {
  return (
    <select
      id={id}
      className="board__select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {timeChoices(value).map((choice) => (
        <option key={choice} value={choice}>
          {formatTimeOfDay(choice)}
        </option>
      ))}
    </select>
  );
}
