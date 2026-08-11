import type { CSSProperties } from "react";
import { categoryOptionFields, type CategoryView } from "@gtp/types";
import { CategoryIcon } from "./CategoryIcon";
import { categoryHueStyle } from "../lib/categoryTheme";
import { costLabel, dateRangeLabel } from "./optionFormat";
import { buildCalendar, hourLabels } from "../lib/calendar";
import type { CalendarPlacement } from "../lib/calendar";
import type { Timeline, TimelineEntry, TimelineSpan } from "../lib/timeline";

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
}: {
  timeline: Timeline;
  onOpen: (option: TimelineEntry["option"], category: CategoryView) => void;
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
                {new Date(day.at).toLocaleDateString(undefined, {
                  weekday: "short",
                })}
              </span>
              <span className="cal__head-day">
                {new Date(day.at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              {uncovered.has(day.key) ? (
                <span className="cal__head-gap">no bed booked</span>
              ) : null}
            </div>
          ))}

          {grid.bandRows > 0 ? (
            <>
              <div className="cal__band-label">Multi-day</div>
              <div className="cal__band">
                {grid.bands.map((band) => (
                  <BandBar
                    key={band.span.option.id}
                    span={band.span}
                    fromIndex={band.fromIndex}
                    toIndex={band.toIndex}
                    row={band.row}
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
                  {new Date(2026, 0, 1, h).toLocaleTimeString(undefined, {
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
              {hours.map((h) => (
                <div key={h} className="cal__slot" aria-hidden="true" />
              ))}
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
    new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const style = {
    ...categoryHueStyle(entry.category),
    top: `${(topMinutes / totalMinutes) * 100}%`,
    height: `${(heightMinutes / totalMinutes) * 100}%`,
    left: `${(lane / laneCount) * 100}%`,
    width: `${(1 / laneCount) * 100}%`,
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
        heightMinutes <= 45 ? "cal__event--tight" : "",
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
    </button>
  );
}

/** One multi-day decision, drawn once across the days it covers. */
function BandBar({
  span,
  fromIndex,
  toIndex,
  row,
  clashes,
  onOpen,
}: {
  span: TimelineSpan;
  fromIndex: number;
  toIndex: number;
  row: number;
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
        gridColumn: `${fromIndex + 1} / ${toIndex + 2}`,
        gridRow: String(row + 1),
      }}
      title={dates ? `${span.option.title} · ${dates}` : span.option.title}
      onClick={() => onOpen(span.option, span.category)}
    >
      <CategoryIcon category={span.category} size={13} />
      <span className="cal__bar-title">{span.option.title}</span>
      <span className="cal__bar-meta">
        {span.nights} night{span.nights === 1 ? "" : "s"}
        {cost ? ` · ${cost}` : ""}
      </span>
    </button>
  );
}
