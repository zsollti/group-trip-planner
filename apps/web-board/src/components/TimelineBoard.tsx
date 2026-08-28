import { useState } from "react";
import { intlTag } from "../lib/locale";
import {
  categoryOptionFields,
  type CategoryView,
  type TripDateRange,
  type OptionView,
} from "@gtp/types";
import { OptionDetail } from "./OptionDetail";
import { OptionForm } from "./OptionForm";
import { CategoryIcon } from "./CategoryIcon";
import { PersonIcon } from "./icons";
import { formatMoney } from "../lib/money";
import { TimelineCalendar } from "./TimelineCalendar";
import { CALENDAR_MIN_WIDTH, useMediaQuery } from "../lib/media";
import { categoryHueStyle } from "../lib/categoryTheme";
import { costLabel, dateRangeLabel } from "./optionFormat";
import {
  dayIndex,
  type Timeline,
  type TimelineEntry,
  type TimelineSpan,
} from "../lib/timeline";
import { plural, t } from "../lib/i18n";

/** Clock time of a moment, or the interval it occupies within its day. */
function timeLabel(entry: TimelineEntry): string {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(intlTag(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  return entry.isPoint
    ? at(entry.start)
    : `${at(entry.start)} – ${at(entry.end)}`;
}

/**
 * A card's dates, written to the precision its subject was captured at.
 *
 * An option's comes from its lane; one of the reader's own items is always to
 * the minute, because "my flight lands at 06:20" is the entire reason it is on
 * a timeline at all.
 */
function entryDates(entry: TimelineEntry): string | null {
  return entry.kind === "option"
    ? dateRangeLabel(
        entry.option.startsAt,
        entry.option.endsAt,
        categoryOptionFields(entry.category).dateGranularity,
      )
    : dateRangeLabel(entry.item.startsAt, entry.item.endsAt, "minute");
}

/** The full date label, for the gutter cards that sit outside a day row. */
function spanLabel(span: TimelineSpan): string | null {
  return entryDates(span);
}

/**
 * The money on a card, whichever kind it is.
 *
 * A personal item's is the plain amount with no `/person` or `total` suffix:
 * those exist because an option's price has to be read against a headcount, and
 * this one is simply what its owner pays.
 */
function entryCost(entry: TimelineEntry): string | null {
  if (entry.kind === "option") return costLabel(entry.option);
  return entry.item.amount === null
    ? null
    : formatMoney(entry.item.amount, entry.item.currency);
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
  const cost = entryCost(entry);
  const span = variant === "span" ? (entry as TimelineSpan) : null;
  // Subordinate, never absent-looking: a proposal has to be legible enough to
  // spot a clash with and quiet enough that it can never read as the plan.
  const proposed = entry.kind === "option" && entry.option.status !== "LOCKED";
  const personal = entry.kind === "personal";

  const inner = (
    <>
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
        <span className="tl__card-title">{entry.title}</span>
        <span className="tl__card-meta">
          {/* No icon in the gutter. A span's pill sits in a ~120px column, and
              at phone width "ACCOMMODATION" plus a glyph runs past the band's
              own edge. Nothing is lost: the band is already drawn in the
              category's colour, with its edge in it, so the icon would be the
              third thing saying the same word. */}
          <span className="tl__tag">
            {/* A single figure rather than the lane's glyph on the reader's own
                cards, tagged or not: the mark answers "who can see this",
                which is the first thing worth knowing about one of these and
                is not what a lane icon says. The colour still comes from the
                tag where there is one. */}
            {span ? null : personal ? (
              <PersonIcon size={13} />
            ) : entry.category ? (
              <CategoryIcon category={entry.category} size={13} />
            ) : null}
            {entry.category?.name ?? t("Personal")}
          </span>
          {span ? <span>{nightsLabel(span.nights)}</span> : null}
          {cost ? <span>{cost}</span> : null}
          {proposed ? (
            <span className="tl__card-flag">{t("Proposed")}</span>
          ) : null}
          {clashes && entry.category ? (
            <span className="tl__card-clash">
              {t("Overlaps another {lane} decision", {
                lane: entry.category.name,
              })}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  const className = [
    "tl__card",
    `tl__card--${variant}`,
    proposed ? "tl__card--proposed" : "",
    personal ? "tl__card--personal" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // The timeline has no lanes to inherit a hue from, so each card carries its
  // own. This is what makes the two pages one app: the colour that means
  // "Accommodation" on the board means it here too. An untagged personal item
  // has none to carry, and CSS supplies the neutral.
  const style = entry.category ? categoryHueStyle(entry.category) : undefined;

  /*
   * A decision is a button; one of the reader's own items is not.
   *
   * The button exists because a card cannot hold an option's whole story — the
   * cost breakdown, who locked it, the link — so the timeline shows when and
   * what and keeps the rest one click away. A personal item has no second
   * story: everything it holds is already on this card, and the one place to
   * change it is the column on the board that owns it. A button that opened
   * nothing would be a promise the view cannot keep.
   */
  if (personal) {
    return (
      <div style={style} className={className}>
        {inner}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} style={style} className={className}>
      {inner}
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
  const cost = entryCost(entry);
  const personal = entry.kind === "personal";
  const body = (
    <>
      <span className="tl__card-title">{entry.title}</span>
      <span className="tl__card-meta">
        <span className="tl__tag">
          {personal ? (
            <PersonIcon size={13} />
          ) : entry.category ? (
            <CategoryIcon category={entry.category} size={13} />
          ) : null}
          {entry.category?.name ?? t("Personal")}
        </span>
        {cost ? <span>{cost}</span> : null}
      </span>
      <span className="tl__card-when">{reason}</span>
    </>
  );
  const className =
    "tl__card tl__card--tray" + (personal ? " tl__card--personal" : "");
  const style = entry.category ? categoryHueStyle(entry.category) : undefined;

  // Inert for the reader's own items, for the reason {@link EntryCard} gives:
  // there is no second story behind one, so a button would open nothing.
  if (personal) {
    return (
      <div className={className} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={className} style={style} onClick={onOpen}>
      {body}
    </button>
  );
}

/**
 * The trip's decisions on a calendar.
 *
 * **Two layouts, one core.** Wide viewports get {@link TimelineCalendar} — days
 * across, hours down, the shape of a day visible. Narrow ones keep the spine
 * below, and that is not a fallback: a week across 390px gives each day about
 * fifty pixels, in which "07:15 – 09:40" is unreadable, and vertical is the
 * direction an itinerary is read in anyway. The argument that built the spine
 * is still right for the size it was made at; it was only ever wrong as a claim
 * about *every* size. Both read the same `timeline.ts` output and share the
 * detail dialog this component owns.
 *
 * In the spine, days run **down**. Two kinds of thing, drawn differently on
 * purpose. Anything crossing a local midnight is a **span** and lives in the
 * left gutter, drawn once across every day it covers rather than repeated into
 * each — repetition is what turns a day-by-day agenda into mush once a hotel is
 * in it. Everything else is a **moment** in its own day, where the time of day
 * is the point. The alignment is real CSS grid rows shared by both columns, so
 * a stay genuinely lines up with the nights it covers however tall those days
 * grow.
 */
export function TimelineBoard({
  timeline,
  tripDates,
  tripId,
  categories,
  defaultCurrency,
  canPropose,
  onProposed,
}: {
  timeline: Timeline;
  /** Passed to the detail dialog for its "outside the trip's dates" note. */
  tripDates: TripDateRange | null;
  tripId: string;
  /**
   * Every lane an option may be proposed into — the Dates lane already
   * filtered out by the caller, for the same reason it is not drawn: locking a
   * Dates option *is* the trip's own range, not a thing that happens at 10:00.
   */
  categories: readonly CategoryView[];
  defaultCurrency: string;
  /** False for a guest, or a board that has ended: the hours stay inert. */
  canPropose: boolean;
  /** A proposal was made from here — see {@link TimelineCanvas}. */
  onProposed: () => void;
}) {
  const [viewing, setViewing] = useState<{
    option: OptionView;
    category: CategoryView;
  } | null>(null);
  // The hour a click landed on, as the instants the form seeds itself from.
  const [creating, setCreating] = useState<{
    startsAt: string;
    endsAt: string;
  } | null>(null);

  const { days, spans, unscheduled, elsewhere, overlapping } = timeline;
  const hasTray = unscheduled.length > 0 || elsewhere.length > 0;
  const uncovered = new Set(timeline.uncoveredNights);
  const wide = useMediaQuery(CALENDAR_MIN_WIDTH);
  const open = (option: OptionView, category: CategoryView) =>
    setViewing({ option, category });

  /**
   * Open a card's detail, when it has one.
   *
   * Passed to every card and does nothing for the reader's own items — those
   * render as plain cards and never call it. Written as one function rather
   * than as a conditional prop so no call site has to know which kind it is
   * holding.
   */
  const openEntry = (entry: TimelineEntry) => {
    if (entry.kind === "option") open(entry.option, entry.category);
  };
  // An hour of the grid, as a pair of instants an hour apart. The day arrives
  // as its own local midnight, so the clock is set on it rather than added to
  // it — the two differ by an hour on the day a timezone changes, and a click
  // on the 09:00 row must open a form saying 09:00 on that day too.
  const create =
    canPropose && categories.length > 0
      ? (dayAt: number, hour: number) => {
          const start = new Date(dayAt);
          start.setHours(hour, 0, 0, 0);
          const end = new Date(start);
          end.setHours(hour + 1, 0, 0, 0);
          setCreating({
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
          });
        }
      : undefined;

  return (
    <>
      {timeline.axis === "derived" ? (
        <p className="tl__banner" role="status">
          {t(
            "This trip's dates aren't settled yet, so the days below are drawn from the options themselves and will shift as they change. Lock a date to frame the trip.",
          )}
        </p>
      ) : null}
      {timeline.truncated ? (
        <p className="tl__banner" role="status">
          {plural(
            days.length,
            "Showing the first {n} day. Something is dated much further out than the rest.",
            "Showing the first {n} days. Something is dated much further out than the rest.",
          )}
        </p>
      ) : null}

      {days.length === 0 ? (
        <p className="tl__empty">
          {hasTray
            ? t(
                "Nothing here has dates yet. Add dates to a decision and it will appear on the trip's calendar.",
              )
            : t(
                "Nothing is decided yet. Lock an option on the board and it lands here.",
              )}
        </p>
      ) : wide ? (
        <TimelineCalendar timeline={timeline} onOpen={open} onCreate={create} />
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
                  {new Date(day.at).toLocaleDateString(intlTag(), {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {day.outsideTrip ? (
                  <span className="tl__day-flag">
                    {t("outside the trip's dates")}
                  </span>
                ) : null}
                {/* On the heading line rather than in a paragraph of its own:
                    given its own row, a free day stood as tall as a busy one
                    and a week with two of them pushed the trip off screen. */}
                {day.entries.length === 0 ? (
                  <span className="tl__day-quiet">{t("nothing planned")}</span>
                ) : null}
              </h3>
              {/* Above the day's plans, because it is a fact about the night
                  rather than another thing that is happening. */}
              {uncovered.has(day.key) ? (
                <p className="tl__gap">{t("Nowhere booked for this night")}</p>
              ) : null}
              {day.entries.length === 0 ? null : (
                <div className="tl__day-items">
                  {day.entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      variant="moment"
                      clashes={overlapping.has(entry.id)}
                      onOpen={() => openEntry(entry)}
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
                key={span.id}
                className="tl__span"
                // On the wrapper, not the band: the band's colour has to be
                // computed from a hue it can see, and the card that would
                // otherwise carry it is the band's *child*.
                style={{
                  gridRow: `${from + 1} / ${to + 2}`,
                  ...(span.category ? categoryHueStyle(span.category) : {}),
                }}
              >
                {/* The band carries the extent and the label sticks to the top
                    of it, so a long stay reads as "this covers all of these"
                    rather than as an empty box with a caption. */}
                <div className="tl__span-band">
                  <EntryCard
                    entry={span}
                    variant="span"
                    clashes={overlapping.has(span.id)}
                    onOpen={() => openEntry(span)}
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
        <section className="tl__tray" aria-label={t("Not on the timeline")}>
          <h2 className="tl__tray-head">{t("Not on the timeline")}</h2>
          <div className="tl__tray-items">
            {unscheduled.map((entry) => (
              <TrayCard
                key={entry.id}
                entry={entry}
                reason="No dates yet"
                onOpen={() => openEntry(entry)}
              />
            ))}
            {elsewhere.map((entry) => (
              <TrayCard
                key={entry.id}
                entry={entry}
                reason={entryDates(entry) ?? t("Outside the trip's dates")}
                onOpen={() => openEntry(entry)}
              />
            ))}
          </div>
          <p className="tl__tray-hint">
            {unscheduled.length > 0
              ? t("Give these dates and they'll take their place on the trip. ")
              : ""}
            {elsewhere.length > 0
              ? t("Some of these fall outside the trip's own dates.")
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

      {/*
       * The board's own propose form, opened from an hour instead of from a
       * lane — the same dialog, with the two things a click on the grid knows
       * already filled in and the one thing it cannot know asked as its first
       * field.
       *
       * Deliberately not a lighter "quick add". A proposal made here is a
       * proposal like any other: it will be voted on, it may carry a price, and
       * the group will read it next to options written on the board. A reduced
       * form would produce visibly poorer cards depending on which screen they
       * were typed on.
       */}
      {creating ? (
        <OptionForm
          tripId={tripId}
          categoryId={categories[0]!.id}
          categoryBuiltinKey={categories[0]!.builtinKey}
          categoryChoices={categories}
          currency={defaultCurrency}
          tripDates={tripDates}
          seed={creating}
          onProposed={onProposed}
          onClose={() => setCreating(null)}
        />
      ) : null}
    </>
  );
}
