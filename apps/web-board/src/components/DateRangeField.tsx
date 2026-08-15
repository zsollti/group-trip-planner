import { useState } from "react";
import { Field, Input } from "@gtp/ui-primitives";
import {
  addMonths,
  cursorFor,
  dayRole,
  monthGrid,
  monthLabel,
  nextSelection,
  weekdayLabels,
  within,
  type DayRole,
  type MonthCursor,
} from "../lib/monthGrid";

/** A start/end pair of calendar days, either end possibly unset. */
export interface DayRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Two dates, picked once.
 *
 * The board used to ask for a start and an end as two unrelated
 * `<input type="date">`s: open one, choose, close, open the other, choose
 * again — and nothing on screen ever showed the two as the span they are. This
 * is the shape every travel site converged on instead: one grid, tap the
 * start, tap the end, with the days between shaded as you move so the second
 * tap is not a guess.
 *
 * **The native inputs stay.** They are not a fallback here, they are the
 * typing path and the keyboard path, and on a phone they open the OS picker,
 * which is better than anything this can be. The grid is an enhancement layered
 * over controls that already worked; it is `hidden` until asked for, and
 * nothing in the form depends on it having been used.
 *
 * The grid is disclosed inline rather than floating. Every place this is used
 * is inside a {@link Dialog} with a focus trap, and a popover inside a trap is
 * a second layer of the same problem — while an inline panel is just more form.
 */
export function DateRangeField({
  idPrefix,
  startLabel,
  endLabel,
  hint,
  value,
  onChange,
  highlight = null,
  highlightLabel,
  extra,
}: {
  /** Namespaces the two input ids, so several of these can share a form. */
  idPrefix: string;
  startLabel: string;
  endLabel: string;
  hint?: string;
  value: DayRange;
  onChange: (next: DayRange) => void;
  /**
   * A span to shade behind the selection — the trip's own dates, when it has
   * settled them.
   *
   * An option's dates mean "when within the trip", and the board already tells
   * a card that falls outside them so afterwards. Drawing the trip's range in
   * the grid answers it one step earlier, while the choice is being made rather
   * than after it is saved.
   */
  highlight?: DayRange | null;
  /** What the shaded span is, for the legend under the grid. */
  highlightLabel?: string;
  /**
   * Fields that belong with the dates — the time-of-day pair, where a category
   * has one. Rendered directly under the two date inputs rather than after the
   * whole control, so opening the calendar cannot push them out of sight
   * halfway down a dialog.
   */
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<MonthCursor>(() =>
    cursorFor(value.start || highlight?.start || null),
  );
  const [hovered, setHovered] = useState<string | null>(null);

  const start = value.start || null;
  const end = value.end || null;

  function pick(iso: string) {
    const next = nextSelection(iso, start, end);
    onChange({ start: next.start, end: next.end ?? "" });
    setHovered(null);
    // Closing on the second tap is the whole gesture ending; closing on the
    // first would make the range impossible to finish.
    if (next.end) setOpen(false);
  }

  return (
    <div className="drange">
      <div className="board__form-grid drange__fields">
        <Field htmlFor={`${idPrefix}-start`} label={startLabel} hint={hint}>
          <Input
            id={`${idPrefix}-start`}
            type="date"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </Field>
        <Field htmlFor={`${idPrefix}-end`} label={endLabel}>
          <Input
            id={`${idPrefix}-end`}
            type="date"
            value={value.end}
            // The picker cannot make an inverted range; typing still can, so
            // the native control refuses it here the way it always did.
            min={value.start || undefined}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </Field>
      </div>

      {extra}

      <button
        type="button"
        className="drange__toggle"
        aria-expanded={open}
        aria-controls={`${idPrefix}-grid`}
        onClick={() => {
          // Reopening on the month you are working in, not the one you last
          // paged to — the selection is the context, not the scroll position.
          if (!open) setCursor(cursorFor(start || highlight?.start || null));
          setOpen((o) => !o);
        }}
      >
        {open ? "Hide calendar" : "📅 Pick on a calendar"}
      </button>

      <div id={`${idPrefix}-grid`} hidden={!open}>
        {open ? (
          <RangeGrid
            cursor={cursor}
            onCursor={setCursor}
            start={start}
            end={end}
            hovered={hovered}
            onHover={setHovered}
            onPick={pick}
            highlight={highlight}
            highlightLabel={highlightLabel}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Two months side by side, because a range crossing a month boundary is the
 *  common case rather than the exception. They stack below the breakpoint. */
function RangeGrid({
  cursor,
  onCursor,
  start,
  end,
  hovered,
  onHover,
  onPick,
  highlight,
  highlightLabel,
}: {
  cursor: MonthCursor;
  onCursor: (next: MonthCursor) => void;
  start: string | null;
  end: string | null;
  hovered: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  highlight: DayRange | null;
  highlightLabel?: string;
}) {
  const next = addMonths(cursor, 1);
  return (
    <div className="drange__cal" onMouseLeave={() => onHover(null)}>
      <div className="drange__nav">
        <button
          type="button"
          className="drange__step"
          aria-label="Previous month"
          onClick={() => onCursor(addMonths(cursor, -1))}
        >
          ‹
        </button>
        {/* The instruction, where the question is asked. Two taps is obvious
            once you have done it and not before. */}
        <p className="drange__prompt" role="status">
          {start && !end ? "Now pick the end" : "Pick a start, then an end"}
        </p>
        <button
          type="button"
          className="drange__step"
          aria-label="Next month"
          onClick={() => onCursor(addMonths(cursor, 1))}
        >
          ›
        </button>
      </div>
      <div className="drange__months">
        {[cursor, next].map((c) => (
          <Month
            key={`${c.year}-${c.month}`}
            cursor={c}
            start={start}
            end={end}
            hovered={hovered}
            onHover={onHover}
            onPick={onPick}
            highlight={highlight}
          />
        ))}
      </div>
      {highlight && highlightLabel ? (
        <p className="drange__legend">
          <span className="drange__legend-swatch" aria-hidden="true" />
          {highlightLabel}
        </p>
      ) : null}
    </div>
  );
}

function Month({
  cursor,
  start,
  end,
  hovered,
  onHover,
  onPick,
  highlight,
}: {
  cursor: MonthCursor;
  start: string | null;
  end: string | null;
  hovered: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  highlight: DayRange | null;
}) {
  const days = monthGrid(cursor);
  const weekdays = weekdayLabels();
  const caption = monthLabel(cursor);

  return (
    <table className="drange__month">
      <caption className="drange__caption">{caption}</caption>
      <thead>
        <tr>
          {weekdays.map((w) => (
            <th key={w.long} scope="col">
              <abbr title={w.long}>{w.short}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <tr key={week}>
            {days.slice(week * 7, week * 7 + 7).map((day) => (
              <DayCell
                key={day.iso}
                iso={day.iso}
                dayOfMonth={day.dayOfMonth}
                inMonth={day.inMonth}
                role={dayRole(day.iso, start, end, hovered)}
                inTrip={
                  highlight?.start && highlight.end
                    ? within(day.iso, highlight.start, highlight.end)
                    : false
                }
                onHover={onHover}
                onPick={onPick}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One day.
 *
 * The out-of-month days are dimmed but **not disabled** — they are the seam a
 * range crosses, and a grid that refuses the 1st of the next month makes a
 * two-week trip impossible to select without paging first.
 */
function DayCell({
  iso,
  dayOfMonth,
  inMonth,
  role,
  inTrip,
  onHover,
  onPick,
}: {
  iso: string;
  dayOfMonth: number;
  inMonth: boolean;
  role: DayRole;
  inTrip: boolean;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
}) {
  const classes = [
    "drange__day",
    inMonth ? "" : "drange__day--outside",
    role === "none" ? "" : `drange__day--${role}`,
    inTrip ? "drange__day--trip" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The accessible name is the full date; the visible label is a bare number,
  // which on its own says nothing about which month or year it belongs to.
  const label = new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    dateStyle: "full",
    timeZone: "UTC",
  });

  return (
    <td className="drange__cell">
      <button
        type="button"
        className={classes}
        // The day it stands for, unformatted — the same hook the timeline's
        // day columns carry. The visible label is a bare number and the
        // accessible one is locale-formatted prose, so neither is something
        // another layer can address a specific day by.
        data-day={iso}
        aria-label={label}
        aria-pressed={role === "start" || role === "end" || role === "single"}
        onClick={() => onPick(iso)}
        onMouseEnter={() => onHover(iso)}
        onFocus={() => onHover(iso)}
      >
        {dayOfMonth}
      </button>
    </td>
  );
}
