import { useState } from "react";
import {
  categoryOptionFields,
  type CategoryView,
  type TripDateRange,
} from "@gtp/types";
import { OptionDetail } from "./OptionDetail";
import { costLabel, dateRangeLabel } from "./optionFormat";
import {
  dayIndex,
  type Timeline,
  type TimelineEntry,
  type TimelineSpan,
} from "../lib/timeline";

/** Clock time of a moment, or the interval it occupies within its day. */
function timeLabel(entry: TimelineEntry): string {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  return entry.isPoint
    ? at(entry.start)
    : `${at(entry.start)} – ${at(entry.end)}`;
}

/** The full date label, for the gutter cards that sit outside a day row. */
function spanLabel(span: TimelineSpan): string | null {
  return dateRangeLabel(
    span.option.startsAt,
    span.option.endsAt,
    categoryOptionFields(span.category).dateGranularity,
  );
}

function nightsLabel(nights: number): string {
  return `${nights} night${nights === 1 ? "" : "s"}`;
}

/**
 * One decision on the spine. A button, because the whole card opens the
 * option's detail — the timeline shows when and what, and everything else
 * (cost breakdown, who locked it, the link) stays one click away rather than
 * being crammed into a row that has to stay scannable.
 */
function EntryCard({
  entry,
  variant,
  clashes,
  onOpen,
}: {
  entry: TimelineEntry;
  variant: "moment" | "span";
  /** Collides with another decision in the same category. */
  clashes: boolean;
  onOpen: () => void;
}) {
  const cost = costLabel(entry.option);
  const span = variant === "span" ? (entry as TimelineSpan) : null;
  // Subordinate, never absent-looking: a proposal has to be legible enough to
  // spot a clash with and quiet enough that it can never read as the plan.
  const proposed = entry.option.status !== "LOCKED";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "tl__card",
        `tl__card--${variant}`,
        proposed ? "tl__card--proposed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="tl__card-when">
        {span
          ? (spanLabel(span) ?? nightsLabel(span.nights))
          : timeLabel(entry)}
      </span>
      {/* The time is a sibling of the body rather than part of it, so a moment
          card can give it its own grid column and line the day's start times
          up into an edge the eye can run down. */}
      <span className="tl__card-body">
        {/* Never character-truncated. The 15-character cap exists because a
            board lane is a 15rem column, and it is too blunt here: the gutter
            fits "Hotel Luna Split" and "Hotel Luna Spli…" helps nobody. The
            gutter clamps to two lines in CSS instead, where the real width is
            known; the day column is the page's measure and needs neither. */}
        <span className="tl__card-title">{entry.option.title}</span>
        <span className="tl__card-meta">
          <span className="tl__tag">{entry.category.name}</span>
          {span ? <span>{nightsLabel(span.nights)}</span> : null}
          {cost ? <span>{cost}</span> : null}
          {proposed ? <span className="tl__card-flag">Proposed</span> : null}
          {clashes ? (
            <span className="tl__card-clash">
              Overlaps another {entry.category.name} decision
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A decision that could not be placed, with the reason it could not. */
function TrayCard({
  entry,
  reason,
  onOpen,
}: {
  entry: TimelineEntry;
  reason: string;
  onOpen: () => void;
}) {
  const cost = costLabel(entry.option);
  return (
    <button type="button" className="tl__card tl__card--tray" onClick={onOpen}>
      <span className="tl__card-title">{entry.option.title}</span>
      <span className="tl__card-meta">
        <span className="tl__tag">{entry.category.name}</span>
        {cost ? <span>{cost}</span> : null}
      </span>
      <span className="tl__card-when">{reason}</span>
    </button>
  );
}

/**
 * The trip's decisions on a calendar.
 *
 * Days run **down**, not across. A week across a phone gives each day about
 * fifty pixels, in which "07:15 – 09:40" is unreadable — and vertical is the
 * direction an itinerary is read in anyway. The same layout serves a long trip
 * without compressing, and a wide screen just gets a roomier version of it
 * rather than a second layout to maintain.
 *
 * Two kinds of thing, drawn differently on purpose. Anything crossing a local
 * midnight is a **span** and lives in the left gutter, drawn once across every
 * day it covers rather than repeated into each — repetition is what turns a
 * day-by-day agenda into mush once a hotel is in it. Everything else is a
 * **moment** in its own day, where the time of day is the point. The alignment
 * is real CSS grid rows shared by both columns, so a stay genuinely lines up
 * with the nights it covers however tall those days grow.
 */
export function TimelineBoard({
  timeline,
  tripDates,
}: {
  timeline: Timeline;
  /** Passed to the detail dialog for its "outside the trip's dates" note. */
  tripDates: TripDateRange | null;
}) {
  const [viewing, setViewing] = useState<{
    option: TimelineEntry["option"];
    category: CategoryView;
  } | null>(null);

  const { days, spans, unscheduled, elsewhere, overlapping } = timeline;
  const hasTray = unscheduled.length > 0 || elsewhere.length > 0;
  const uncovered = new Set(timeline.uncoveredNights);

  return (
    <>
      {timeline.axis === "derived" ? (
        <p className="tl__banner" role="status">
          This trip's dates aren't settled yet, so the days below are drawn from
          the options themselves and will shift as they change. Lock a date to
          frame the trip.
        </p>
      ) : null}
      {timeline.truncated ? (
        <p className="tl__banner" role="status">
          Showing the first {days.length} days — something is dated much further
          out than the rest.
        </p>
      ) : null}

      {days.length === 0 ? (
        <p className="tl__empty">
          {hasTray
            ? "Nothing here has dates yet. Add dates to a decision and it will appear on the trip's calendar."
            : "Nothing is decided yet. Lock an option on the board and it lands here."}
        </p>
      ) : (
        <div className="tl__grid">
          {days.map((day, i) => (
            <div
              key={day.key}
              // The heading renders in the reader's own locale, so the calendar
              // day is also exposed as a stable value — for tests, and for
              // anything that needs to find a day without parsing a label.
              data-day={day.key}
              className={[
                "tl__day",
                day.outsideTrip ? "tl__day--outside" : "",
                day.entries.length === 0 ? "tl__day--bare" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ gridRow: i + 1 }}
            >
              <h3 className="tl__day-head">
                <span className="tl__day-name">
                  {new Date(day.at).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {day.outsideTrip ? (
                  <span className="tl__day-flag">outside the trip's dates</span>
                ) : null}
                {/* On the heading line rather than in a paragraph of its own:
                    given its own row, a free day stood as tall as a busy one
                    and a week with two of them pushed the trip off screen. */}
                {day.entries.length === 0 ? (
                  <span className="tl__day-quiet">nothing planned</span>
                ) : null}
              </h3>
              {/* Above the day's plans, because it is a fact about the night
                  rather than another thing that is happening. */}
              {uncovered.has(day.key) ? (
                <p className="tl__gap">Nowhere booked for this night</p>
              ) : null}
              {day.entries.length === 0 ? null : (
                <div className="tl__day-items">
                  {day.entries.map((entry) => (
                    <EntryCard
                      key={entry.option.id}
                      entry={entry}
                      variant="moment"
                      clashes={overlapping.has(entry.option.id)}
                      onOpen={() =>
                        setViewing({
                          option: entry.option,
                          category: entry.category,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {spans.map((span) => {
            // Clamped rather than trusted: a span always reaches days the axis
            // was widened to include, but a -1 here would silently place the
            // card on row 0 and break every row below it.
            const from = Math.max(0, dayIndex(days, span.firstDay));
            const to = Math.max(from, dayIndex(days, span.lastDay));
            return (
              <div
                key={span.option.id}
                className="tl__span"
                style={{ gridRow: `${from + 1} / ${to + 2}` }}
              >
                {/* The band carries the extent and the label sticks to the top
                    of it, so a long stay reads as "this covers all of these"
                    rather than as an empty box with a caption. */}
                <div className="tl__span-band">
                  <EntryCard
                    entry={span}
                    variant="span"
                    clashes={overlapping.has(span.option.id)}
                    onOpen={() =>
                      setViewing({
                        option: span.option,
                        category: span.category,
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Never a silent omission: a page that quietly drew three of eight
          decisions would be read as the whole trip. */}
      {hasTray ? (
        <section className="tl__tray" aria-label="Not on the timeline">
          <h2 className="tl__tray-head">Not on the timeline</h2>
          <div className="tl__tray-items">
            {unscheduled.map((entry) => (
              <TrayCard
                key={entry.option.id}
                entry={entry}
                reason="No dates yet"
                onOpen={() =>
                  setViewing({
                    option: entry.option,
                    category: entry.category,
                  })
                }
              />
            ))}
            {elsewhere.map((entry) => (
              <TrayCard
                key={entry.option.id}
                entry={entry}
                reason={
                  dateRangeLabel(
                    entry.option.startsAt,
                    entry.option.endsAt,
                    categoryOptionFields(entry.category).dateGranularity,
                  ) ?? "Outside the trip's dates"
                }
                onOpen={() =>
                  setViewing({
                    option: entry.option,
                    category: entry.category,
                  })
                }
              />
            ))}
          </div>
          <p className="tl__tray-hint">
            {unscheduled.length > 0
              ? "Give these dates and they'll take their place on the trip. "
              : ""}
            {elsewhere.length > 0
              ? "Some of these fall outside the trip's own dates."
              : ""}
          </p>
        </section>
      ) : null}

      {viewing ? (
        <OptionDetail
          category={viewing.category}
          option={viewing.option}
          tripDates={tripDates}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}
