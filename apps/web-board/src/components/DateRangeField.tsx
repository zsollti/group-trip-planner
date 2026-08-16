import { useEffect, useRef, useState } from "react";
import { UI_LOCALE } from "../lib/locale";
import {
  addMonths,
  cursorFor,
  dayRole,
  isoDay,
  monthGrid,
  monthLabel,
  moveFocus,
  nextSelection,
  parseDay,
  weekdayLabels,
  within,
  type DayRole,
  type GridKey,
  type MonthCursor,
} from "../lib/monthGrid";

/** A start/end pair of calendar days, either end possibly unset. */
export interface DayRange {
  readonly start: string;
  readonly end: string;
}

const GRID_KEYS = new Set<string>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Two dates, picked once, on a calendar that is simply there.
 *
 * The board used to ask for a start and an end as two unrelated
 * `<input type="date">`s: open one, choose, close, open the other, choose
 * again — and nothing on screen ever showed the two as the span they are. Tap
 * the start, tap the end, with the days between shaded as you move so the
 * second tap is not a guess.
 *
 * **The grid is the control, not an enhancement over one.** Its first version
 * kept the two native inputs and hid the calendar behind a "Pick on a calendar"
 * button, which meant every form asked the same question twice and made you
 * open the better answer by hand. The inputs are gone and the grid is open.
 *
 * That moved the keyboard story onto the grid, where it now belongs: the cells
 * are a **roving tabindex** — one tab stop for the whole calendar, then arrows
 * by day and week, Home/End across the week, PageUp/PageDown by month, Enter or
 * Space to pick ({@link moveFocus}). Eighty-four tab stops would have been
 * worse than the inputs it replaced.
 */
export function DateRangeField({
  idPrefix,
  legend,
  hint,
  value,
  onChange,
  highlight = null,
  highlightLabel,
  extra,
}: {
  /** Namespaces the ids inside, so several of these can share a form. */
  idPrefix: string;
  /** What this range is — the calendar's accessible name and its caption. */
  legend: string;
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
  /** Fields that belong with the dates — the time-of-day pair, where a category
   *  has one. Rendered under the grid, since they qualify what it produced. */
  extra?: React.ReactNode;
}) {
  const [cursor, setCursor] = useState<MonthCursor>(() =>
    cursorFor(value.start || highlight?.start || null),
  );
  const [hovered, setHovered] = useState<string | null>(null);

  const start = value.start || null;
  const end = value.end || null;

  /**
   * The one cell in the tab order. Seeded from the selection so tabbing in
   * lands where the reader last was, rather than on the 1st of the month.
   */
  const [focused, setFocused] = useState<string>(
    () => value.start || firstOfCursor(cursorFor(value.start || null)),
  );
  // Only steal focus when *we* moved it — otherwise every re-render would drag
  // focus back into the calendar from wherever the reader had gone.
  const takeFocus = useRef(false);

  function pick(iso: string) {
    const next = nextSelection(iso, start, end);
    onChange({ start: next.start, end: next.end ?? "" });
    setHovered(null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!GRID_KEYS.has(e.key)) return;
    const next = moveFocus(focused, e.key as GridKey);
    if (!next) return;
    e.preventDefault();
    setFocused(next);
    takeFocus.current = true;
    // Follow the focus when it leaves the two months on screen, so the day that
    // now has focus is a day the reader can see.
    const d = parseDay(next);
    if (d) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const second = addMonths(cursor, 1);
      const shown =
        (y === cursor.year && m === cursor.month) ||
        (y === second.year && m === second.month);
      if (!shown) setCursor({ year: y, month: m });
    }
  }

  return (
    <fieldset className="drange" onKeyDown={onKeyDown}>
      <legend className="drange__legend-text">{legend}</legend>
      {hint ? <p className="drange__hint">{hint}</p> : null}
      <RangeGrid
        idPrefix={idPrefix}
        cursor={cursor}
        onCursor={setCursor}
        start={start}
        end={end}
        hovered={hovered}
        onHover={setHovered}
        onPick={pick}
        focused={focused}
        onFocused={setFocused}
        takeFocus={takeFocus}
        highlight={highlight}
        highlightLabel={highlightLabel}
        onClear={start ? () => onChange({ start: "", end: "" }) : undefined}
      />
      {extra}
    </fieldset>
  );
}

/** The first day of a cursor's month — the fallback focus when nothing is picked. */
function firstOfCursor(cursor: MonthCursor): string {
  return isoDay(new Date(Date.UTC(cursor.year, cursor.month, 1)));
}

/** Two months side by side, because a range crossing a month boundary is the
 *  common case rather than the exception. They stack below the breakpoint. */
function RangeGrid({
  idPrefix,
  cursor,
  onCursor,
  start,
  end,
  hovered,
  onHover,
  onPick,
  focused,
  onFocused,
  takeFocus,
  highlight,
  highlightLabel,
  onClear,
}: {
  idPrefix: string;
  cursor: MonthCursor;
  onCursor: (next: MonthCursor) => void;
  start: string | null;
  end: string | null;
  hovered: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  focused: string;
  onFocused: (iso: string) => void;
  takeFocus: React.MutableRefObject<boolean>;
  highlight: DayRange | null;
  highlightLabel?: string;
  onClear?: () => void;
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
            idPrefix={idPrefix}
            cursor={c}
            start={start}
            end={end}
            hovered={hovered}
            onHover={onHover}
            onPick={onPick}
            focused={focused}
            onFocused={onFocused}
            takeFocus={takeFocus}
            highlight={highlight}
          />
        ))}
      </div>
      <div className="drange__foot">
        {/* What is chosen, as a sentence. The two inputs used to say this by
            holding it; nothing else on the grid states the range in words, and
            a reader should not have to decode shading to check what they
            picked. */}
        <p className="drange__chosen" aria-live="polite">
          {start ? (
            <>
              <strong>{longDay(start)}</strong>
              {end && end !== start ? (
                <>
                  {" – "}
                  <strong>{longDay(end)}</strong>
                </>
              ) : null}
            </>
          ) : (
            <span className="drange__chosen--empty">No dates chosen</span>
          )}
        </p>
        {/* Without the inputs there is no way to blank a range you set by
            mistake — every tap sets something. */}
        {onClear ? (
          <button type="button" className="drange__clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
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

/** A day in the reader's locale, spelled out. UTC, because it is a day. */
function longDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(UI_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Month({
  idPrefix,
  cursor,
  start,
  end,
  hovered,
  onHover,
  onPick,
  focused,
  onFocused,
  takeFocus,
  highlight,
}: {
  idPrefix: string;
  cursor: MonthCursor;
  start: string | null;
  end: string | null;
  hovered: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  focused: string;
  onFocused: (iso: string) => void;
  takeFocus: React.MutableRefObject<boolean>;
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
                idPrefix={idPrefix}
                iso={day.iso}
                dayOfMonth={day.dayOfMonth}
                inMonth={day.inMonth}
                role={dayRole(day.iso, start, end, hovered)}
                inTrip={
                  highlight?.start && highlight.end
                    ? within(day.iso, highlight.start, highlight.end)
                    : false
                }
                focused={day.iso === focused}
                onFocused={onFocused}
                takeFocus={takeFocus}
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
  idPrefix,
  iso,
  dayOfMonth,
  inMonth,
  role,
  inTrip,
  focused,
  onFocused,
  takeFocus,
  onHover,
  onPick,
}: {
  idPrefix: string;
  iso: string;
  dayOfMonth: number;
  inMonth: boolean;
  role: DayRole;
  inTrip: boolean;
  focused: boolean;
  onFocused: (iso: string) => void;
  takeFocus: React.MutableRefObject<boolean>;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Pull focus only after a key moved it. Without the flag every render would
  // yank focus back into the grid from wherever the reader had tabbed to.
  useEffect(() => {
    if (focused && takeFocus.current) {
      takeFocus.current = false;
      ref.current?.focus();
    }
  }, [focused, takeFocus]);

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
  const label = new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(UI_LOCALE, {
    dateStyle: "full",
    timeZone: "UTC",
  });

  return (
    <td className="drange__cell">
      <button
        ref={ref}
        type="button"
        id={`${idPrefix}-day-${iso}`}
        className={classes}
        // The day it stands for, unformatted — the same hook the timeline's
        // day columns carry. The visible label is a bare number and the
        // accessible one is locale-formatted prose, so neither is something
        // another layer can address a specific day by.
        data-day={iso}
        aria-label={label}
        aria-pressed={role === "start" || role === "end" || role === "single"}
        // Roving: exactly one cell is in the tab order at a time.
        tabIndex={focused ? 0 : -1}
        onClick={() => onPick(iso)}
        onMouseEnter={() => onHover(iso)}
        onFocus={() => {
          onFocused(iso);
          onHover(iso);
        }}
      >
        {dayOfMonth}
      </button>
    </td>
  );
}
