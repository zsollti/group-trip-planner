import { useEffect, useRef, useState } from "react";
import { parseTypedTime, sanitizeTypedTime } from "../lib/timeOfDay";
import { t } from "../lib/i18n";

/**
 * A time of day, typed.
 *
 * Replaces the quarter-hour `<select>`, which replaced `<input type="time">`.
 * The list was right that a proposal is not a timetable and wrong about what
 * that costs: 96 rows is a lot of scrolling to reach 19:00, and a quarter-hour
 * grid cannot express 19:20 at all. Four keystrokes can express both.
 *
 * **Two values, on purpose.** What is being typed is local state; what the form
 * holds is always a settled `"HH:MM"` (or empty). They part company mid-word:
 * `19:4` is a complete answer that is still being spelled, so the form takes
 * `19:04` from it immediately while the field goes on saying `19:4` until the
 * reader leaves it. Rewriting the text as they type would move the caret and
 * fight them for a colon they were about to type themselves.
 *
 * The form is updated on **every** keystroke that parses, not on blur. Blur
 * looks like the natural moment and quietly depends on the browser firing it
 * before the click that submits — true with a mouse, and not something the
 * correctness of a saved time should rest on. Blur here only tidies the
 * display, and puts the last good value back if what is in the field is not a
 * time at all: an error message for a field somebody has already walked away
 * from helps nobody. Empty stays a real answer — an option's dates are optional
 * and so is the time on them.
 *
 * 24-hour, whatever the reader's clock convention. The `<select>` could afford
 * to label its rows "1:00 PM" because the reader was choosing a row, not
 * writing one; a field that *accepts* `1:00 PM` has to decide what a bare
 * `1:00` meant, and there is no answer to that which is right twice a day.
 */
export function TimeField({
  id,
  value,
  onChange,
}: {
  id: string;
  /** The settled value, `"HH:MM"` or `""`. */
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // The last value this field itself sent up. Without it, following `value`
  // *is* fighting the typist: pressing `1` commits `01:00`, `value` becomes
  // `01:00`, and the effect writes that straight back over the `1` they were
  // three keys away from finishing.
  const ownCommit = useRef(value);

  // Follow the form when it changes the value from outside — the option form
  // seeds both times when a day is first picked, and re-seeds them on edit.
  useEffect(() => {
    if (value === ownCommit.current) return;
    ownCommit.current = value;
    setDraft(value);
  }, [value]);

  /** Take the best reading of what is typed, without touching the text. */
  function type(raw: string) {
    const next = sanitizeTypedTime(raw);
    setDraft(next);
    const parsed = parseTypedTime(next);
    if (parsed === null || parsed === value) return;
    ownCommit.current = parsed;
    onChange(parsed);
  }

  /** Settle the display: `19:4` becomes `19:04`, nonsense becomes what it was. */
  function settle() {
    const parsed = parseTypedTime(draft);
    setDraft(parsed ?? value);
  }

  return (
    <input
      id={id}
      data-gtp-input
      type="text"
      // Not `type="time"`: that is the browser's own three-part control, which
      // is the thing being replaced. `inputMode` is what gets a phone keyboard
      // to open on digits, which is the only part of it worth keeping.
      inputMode="numeric"
      autoComplete="off"
      // Four digits and a separator. The cap is the format, so a fifth digit
      // has nowhere to go rather than being silently dropped on the way out.
      maxLength={5}
      placeholder={t("hh:mm")}
      value={draft}
      onChange={(e) => type(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        // Settle it in place, so four digits can be seen becoming a time
        // without leaving the field. The value is already committed either way.
        if (e.key === "Enter") {
          e.preventDefault();
          settle();
        }
      }}
    />
  );
}
