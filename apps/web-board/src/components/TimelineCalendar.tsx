import type { CSSProperties } from "react";
import { intlTag } from "../lib/locale";
import { categoryOptionFields, type CategoryView } from "@gtp/types";
import { CategoryIcon } from "./CategoryIcon";
import { calendarDetail } from "../lib/calendarDetail";
import { categoryHueStyle } from "../lib/categoryTheme";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { buildCalendar, hourLabels } from "../lib/calendar";
import type { CalendarPlacement } from "../lib/calendar";
import type { Timeline, TimelineEntry, TimelineSpan } from "../lib/timeline";
import { plural, t } from "../lib/i18n";

/**
 * The trip as a week grid — days across, hours down.
 *
 * What this adds over the spine is **shape**. A list can tell you a tram ride
 * and an afternoon in Belém both happen on Friday; only a grid tells you the
 * morning is free, that the tram ride is half the length of Belém, and that
 * two things were booked for the same hour. That is the question people open a
 * calendar to answer, and it is the one a list structurally cannot.
 *
 * **Multi-day things live in the band at the top, not in the grid.** This is
 * the device every calendar uses for all-day events and it is exactly right
 * here: a hotel is not a thing that happens at 3pm on Tuesday, it is the state
 * you are in for four days. Drawing it once across the days it covers keeps it
 * out of the hours, where it would otherwise be a wall behind everything you
 * actually did. Which entries qualify is derived — anything crossing a local
 * midnight — so an overnight train gets the same treatment without anyone
 * hard-coding a category.
 *
 * Narrow viewports keep the vertical spine; see `lib/media.ts` for where the
 * line is drawn and why.
 */
export function TimelineCalendar({
  timeline,
  onOpen,
  onCreate,
}: {
  timeline: Timeline;
  onOpen: (option: TimelineEntry["option"], category: CategoryView) => void;
  /**
   * Propose something in an empty hour — given the day's local midnight and the
   * hour clicked. Undefined for a reader who may not propose, or a frozen
   * board, and then the slots are inert decoration again.
   */
  onCreate?: (dayAt: number, hour: number) => void;
}) {
  const grid = buildCalendar(timeline.days, timeline.spans);
  const hours = hourLabels(grid);
  const totalMinutes = (grid.endHour - grid.startHour) * 60;
  const uncovered = new Set(timeline.uncoveredNights);

  const style = {
    "--cal-days": String(grid.days.length),
    "--cal-hours": String(hours.length),
    "--cal-band-rows": String(Math.max(grid.bandRows, 0)),
  } as CSSProperties;

  return (
    // Scrolls sideways rather than squeezing: a fortnight would put every
    // column below the width a day can be read at, and a calendar you cannot
    // read is worse than the list it replaced.
    <div className="cal" style={style}>
      <div className="cal__scroll">
        <div className="cal__frame">
          {/* Header row: the weekday, which is the whole point of a calendar —
              nobody should have to work out that the 16th is a Wednesday. */}
          <div className="cal__corner" aria-hidden="true" />
          {grid.days.map((day) => (
            <div
              key={day.key}
              className={
                "cal__head" + (day.outsideTrip ? " cal__head--outside" : "")
              }
              data-day={day.key}
            >
              <span className="cal__head-dow">
                {new Date(day.at).toLocaleDateString(intlTag(), {
                  weekday: "short",
                })}
              </span>
              <span className="cal__head-day">
                {new Date(day.at).toLocaleDateString(intlTag(), {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              {uncovered.has(day.key) ? (
                <span className="cal__head-gap">{t("no bed booked")}</span>
              ) : null}
            </div>
          ))}

          {grid.bandRows > 0 ? (
            <>
              <div className="cal__band-label">{t("Multi-day")}</div>
              <div className="cal__band">
                {grid.bands.map((band) => (
                  <BandBar
                    key={band.span.option.id}
                    span={band.span}
                    fromIndex={band.fromIndex}
                    toIndex={band.toIndex}
                    row={band.row}
                    leadFraction={band.leadFraction}
                    widthFraction={band.widthFraction}
                    clashes={timeline.overlapping.has(band.span.option.id)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </>
          ) : null}

          <div className="cal__hours">
            {hours.map((h) => (
              <div key={h} className="cal__hour">
                <span className="cal__hour-label">
                  {/* Formatted, not `${h}:00` — a 12-hour locale should read
                      "1 PM", and `Intl` is what knows that. */}
                  {new Date(2026, 0, 1, h).toLocaleTimeString(intlTag(), {
                    hour: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>

          {grid.days.map((day) => (
            <div
              key={day.key}
              className={
                "cal__col" + (day.outsideTrip ? " cal__col--outside" : "")
              }
            >
              {/*
               * The empty hours, which are now the way to fill them.
               *
               * They were `aria-hidden` rules drawn so the grid had lines. The
               * calendar is where you can see that Thursday morning is free,
               * and it was the one surface in the app where seeing that led
               * nowhere — the answer was to leave, find the right lane, open
               * its form and type the day and the time back in by hand. A
               * click here carries both.
               *
               * A `<button>` rather than a click handler on the div, so it is
               * reachable and operable from the keyboard and announces what it
               * will do. It is `tabIndex={-1}` all the same: a fortnight of
               * fourteen-hour days is a couple of hundred empty cells, and
               * putting every one of them in the tab order would bury the rest
               * of the page behind them. Arrow-key roving would be the fuller
               * answer; the lane's own "propose" button remains the keyboard's
               * short road, and it is one Tab away on the board.
               */}
              {hours.map((h) =>
                onCreate ? (
                  <button
                    key={h}
                    type="button"
                    tabIndex={-1}
                    className="cal__slot cal__slot--open"
                    aria-label={t("Propose something at {time} on {day}", {
                      time: new Date(2026, 0, 1, h).toLocaleTimeString(
                        intlTag(),
                        { hour: "numeric" },
                      ),
                      day: new Date(day.at).toLocaleDateString(intlTag(), {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      }),
                    })}
                    onClick={() => onCreate(day.at, h)}
                  />
                ) : (
                  <div key={h} className="cal__slot" aria-hidden="true" />
                ),
              )}
              {day.placements.map((p) => (
                <TimedBlock
                  key={p.entry.option.id}
                  placement={p}
                  totalMinutes={totalMinutes}
                  clashes={timeline.overlapping.has(p.entry.option.id)}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One timed decision, positioned by when it starts and how long it runs. */
function TimedBlock({
  placement,
  totalMinutes,
  clashes,
  onOpen,
}: {
  placement: CalendarPlacement;
  totalMinutes: number;
  clashes: boolean;
  onOpen: (option: TimelineEntry["option"], category: CategoryView) => void;
}) {
  const { entry, topMinutes, heightMinutes, lane, laneCount } = placement;
  const proposed = entry.option.status !== "LOCKED";
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(intlTag(), {
      hour: "2-digit",
      minute: "2-digit",
    });

  // What the block is tall enough to say — cost first, then the note.
  const detail = calendarDetail(heightMinutes);
  const cost = costLabel(entry.option);
  const note = entry.option.description?.trim();

  const style = {
    ...categoryHueStyle(entry.category),
    top: `${(topMinutes / totalMinutes) * 100}%`,
    height: `${(heightMinutes / totalMinutes) * 100}%`,
    left: `${(lane / laneCount) * 100}%`,
    width: `${(1 / laneCount) * 100}%`,
    // The note is clamped to whatever the block has left, so a long one is
    // trimmed by the browser at a line boundary instead of spilling past the
    // block and over the hour below it.
    "--note-lines": detail.noteLines,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={[
        "cal__event",
        proposed ? "cal__event--proposed" : "",
        clashes ? "cal__event--clash" : "",
        // Under about 45 minutes there is no room for a second line, so the
        // title and time share one rather than being clipped mid-word.
        detail.tight ? "cal__event--tight" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onClick={() => onOpen(entry.option, entry.category)}
    >
      <span className="cal__event-title">{entry.option.title}</span>
      <span className="cal__event-when">
        {entry.isPoint
          ? at(entry.start)
          : `${at(entry.start)}–${at(entry.end)}`}
      </span>
      {detail.showCost && cost ? (
        <span className="cal__event-cost">{cost}</span>
      ) : null}
      {detail.showNote && note ? (
        <span className="cal__event-note">{note}</span>
      ) : null}
    </button>
  );
}

/** One multi-day decision, drawn once across the days it covers. */
function BandBar({
  span,
  fromIndex,
  toIndex,
  row,
  leadFraction,
  widthFraction,
  clashes,
  onOpen,
}: {
  span: TimelineSpan;
  fromIndex: number;
  toIndex: number;
  row: number;
  /** Where the bar starts and ends inside its columns — see `CalendarBand`. */
  leadFraction: number;
  widthFraction: number;
  clashes: boolean;
  onOpen: (option: TimelineEntry["option"], category: CategoryView) => void;
}) {
  const proposed = span.option.status !== "LOCKED";
  const cost = costLabel(span.option);
  const dates = dateRangeLabel(
    span.option.startsAt,
    span.option.endsAt,
    categoryOptionFields(span.category).dateGranularity,
  );

  return (
    /* Two elements, because a percentage needs the right box to resolve
       against. The slot spans whole grid columns; the bar inside it is placed
       as a fraction of the slot, which is exactly a fraction of those columns.
       Insetting the bar directly with a percentage margin would have measured
       against the whole band instead, and every bar would have started in a
       different wrong place depending on how long the trip was. */
    <div
      className="cal__bar-slot"
      style={{
        gridColumn: `${fromIndex + 1} / ${toIndex + 2}`,
        gridRow: String(row + 1),
      }}
    >
      <button
        type="button"
        className={[
          "cal__bar",
          proposed ? "cal__bar--proposed" : "",
          clashes ? "cal__bar--clash" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          ...categoryHueStyle(span.category),
          marginInlineStart: `${leadFraction * 100}%`,
          width: `${widthFraction * 100}%`,
        }}
        title={dates ? `${span.option.title} · ${dates}` : span.option.title}
        onClick={() => onOpen(span.option, span.category)}
      >
        <CategoryIcon category={span.category} size={13} />
        <span className="cal__bar-title">{span.option.title}</span>
        <span className="cal__bar-meta">
          {plural(span.nights, "{n} night", "{n} nights")}
          {cost ? ` · ${cost}` : ""}
        </span>
      </button>
    </div>
  );
}
