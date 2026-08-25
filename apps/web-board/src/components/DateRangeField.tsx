import { useEffect, useRef, useState } from "react";
import { intlTag } from "../lib/locale";
import {
  addMonths,
  cursorFor,
  dayRole,
  isInMonth,
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
import { t } from "../lib/i18n";

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
  /*
   * Today, as the first day anything here may be.
   *
   * Every range this control produces is in the future by the rules the server
   * already enforces: a trip is created with dates ahead of now, and locking a
   * Dates option is refused outright when its start has passed. A grid that
   * offers yesterday is offering something that will be turned down, which is
   * this board's own standing rule about affordances (`docs/ui-audit.md` §3) —
   * and the reader finds out after filling the form rather than while pointing
   * at the day.
   *
   * Computed once per mount rather than per render: a component that is open
   * across midnight is not worth a timer, and re-deriving it on every keystroke
   * would let the boundary move under a half-finished selection.
   */
  const [today] = useState(todayIso);

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
    // The grid draws past days as unavailable; this is what makes that true
    // rather than a colour. Keyboard and pointer land here alike, so there is
    // one rule and not two.
    if (iso < today) return;
    // Always a complete pair now — one tap is a one-day answer, a later second
    // tap stretches it. See `nextSelection`.
    const next = nextSelection(iso, start, end);
    onChange(next);
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
        min={today}
        focused={focused}
        onFocused={setFocused}
        takeFocus={takeFocus}
        highlight={highlight}
        highlightLabel={highlightLabel}
        onClear={start ? () => onChange({ start: "", end: "" }) : undefined}
      />
      {/* Wrapped so what follows the grid is separated from it. Unwrapped, a
          field put here — the option form's start and end times — had its label
          sitting directly on the calendar's bottom edge, close enough to read
          as a caption for the calendar rather than as the heading of the
          control under it. The gap is the whole difference between "this
          belongs to that" and "this is next". */}
      {extra ? <div className="drange__extra">{extra}</div> : null}
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
  min,
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
  /** The first day that may be chosen; anything before it is drawn unavailable. */
  min: string;
}) {
  const next = addMonths(cursor, 1);
  return (
    <div className="drange__cal" onMouseLeave={() => onHover(null)}>
      <div className="drange__nav">
        <button
          type="button"
          className="drange__step"
          aria-label={t("Previous month")}
          onClick={() => onCursor(addMonths(cursor, -1))}
        >
          ‹
        </button>
        {/* The instruction, where the question is asked, and it has to change
            with the state now that one tap is already an answer: a grid that
            kept saying "now pick the end" would be asking for a second day the
            reader may not have. */}
        <p className="drange__prompt" role="status">
          {!start
            ? t("Pick a day")
            : end === start
              ? t("One day. Pick a later one to stretch it.")
              : t("Pick any day to start again")}
        </p>
        <button
          type="button"
          className="drange__step"
          aria-label={t("Next month")}
          onClick={() => onCursor(addMonths(cursor, 1))}
        >
          ›
        </button>
      </div>
      <div className="drange__months">
        {[cursor, next].map((c, i) => (
          <Month
            key={`${c.year}-${c.month}`}
            idPrefix={idPrefix}
            cursor={c}
            // The other grid on screen. A day belonging to it is drawn there
            // and blanked here — see `Month`.
            sibling={i === 0 ? next : cursor}
            start={start}
            end={end}
            hovered={hovered}
            onHover={onHover}
            onPick={onPick}
            focused={focused}
            onFocused={onFocused}
            takeFocus={takeFocus}
            highlight={highlight}
            min={min}
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
            <span className="drange__chosen--empty">
              {t("No dates chosen")}
            </span>
          )}
        </p>
        {/* Without the inputs there is no way to blank a range you set by
            mistake — every tap sets something. */}
        {onClear ? (
          <button type="button" className="drange__clear" onClick={onClear}>
            {t("Clear")}
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

/**
 * Today, as the grid writes days.
 *
 * The grid's days are UTC-midnight ISO strings, but "today" is a fact about the
 * *reader's* calendar — so this reads local getters and re-expresses the result
 * in the grid's convention. `isoDay(new Date())` would have been shorter and
 * wrong twice a day: it takes UTC parts of a local instant, so at 20:00 in New
 * York it already says tomorrow, and today would be the first day the calendar
 * refused to let anyone pick. (The same class of bug as reading a `@db.Date`
 * with local getters, in the other direction.)
 */
function todayIso(): string {
  const now = new Date();
  return isoDay(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}

/** A day in the reader's locale, spelled out. UTC, because it is a day. */
function longDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(intlTag(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Month({
  idPrefix,
  cursor,
  sibling,
  start,
  end,
  hovered,
  onHover,
  onPick,
  focused,
  onFocused,
  takeFocus,
  highlight,
  min,
}: {
  idPrefix: string;
  cursor: MonthCursor;
  /** The month in the grid beside this one. */
  sibling: MonthCursor;
  start: string | null;
  end: string | null;
  hovered: string | null;
  onHover: (iso: string | null) => void;
  onPick: (iso: string) => void;
  focused: string;
  onFocused: (iso: string) => void;
  takeFocus: React.MutableRefObject<boolean>;
  highlight: DayRange | null;
  /** The first choosable day — see the note on `today` in `DateRangeField`. */
  min: string;
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
            {days.slice(week * 7, week * 7 + 7).map((day) =>
              isInMonth(day.iso, sibling) ? (
                /*
                 * The same day, twice on one screen.
                 *
                 * Two months are shown, and each six-week grid spills into its
                 * neighbours — so October's trailing row and November's leading
                 * row are the *same days*, drawn in both. Selecting 23–31
                 * October then shaded a stretch of the November calendar as
                 * well, which is arithmetically true and reads as a second,
                 * wrong range.
                 *
                 * It was also two bugs quieter than that: both copies carried
                 * the same `id` and the same `data-day`, and the roving
                 * tabindex put a tab stop on each, so one day was two stops.
                 *
                 * Blanked rather than removed, so the weeks keep their shape.
                 * Only where the day is on screen *anyway* — the outer seams
                 * (September in October's lead, December in November's tail)
                 * still draw, because those are the days a range crosses that
                 * nothing else here offers.
                 */
                <td key={day.iso} className="drange__cell" aria-hidden="true" />
              ) : (
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
                  past={day.iso < min}
                />
              ),
            )}
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
  past,
}: {
  idPrefix: string;
  iso: string;
  dayOfMonth: number;
  inMonth: boolean;
  role: DayRole;
  inTrip: boolean;
  /** Before the first choosable day: drawn dimmed and refusing to be picked. */
  past: boolean;
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
    past ? "drange__day--past" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The accessible name is the full date; the visible label is a bare number,
  // which on its own says nothing about which month or year it belongs to.
  const label = new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(intlTag(), {
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
        /*
         * `aria-disabled`, not `disabled`.
         *
         * A real `disabled` button cannot take focus, and this grid moves focus
         * programmatically with a roving tabindex — arrow into a past day and
         * the `.focus()` call would silently do nothing, stranding the reader
         * with no focus anywhere in the document. Marked-up-as-unavailable keeps
         * the cell reachable and announced, and `pick` is where the refusal
         * actually lives.
         */
        aria-disabled={past || undefined}
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
