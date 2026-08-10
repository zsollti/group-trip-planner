import { describe, expect, it } from "vitest";
import type { CategoryView, OptionView } from "@gtp/types";
import {
  MAX_TIMELINE_DAYS,
  buildTimeline,
  calendarDayToLocalMs,
  localDayKey,
  timelineCandidates,
  tripDayKey,
} from "./timeline";

/**
 * Dates are the whole subject here, so the fixtures are deliberate about which
 * convention each value uses:
 *
 *  - **Options** carry local wall-clock strings (`"2026-07-04T10:00"`), which
 *    every zone parses to its own local instant. That keeps the assertions
 *    zone-independent *and* matches what the option form actually produces.
 *  - **Trips** carry midnight UTC, because that is what a Postgres `date`
 *    column serialises to and therefore what the API really sends.
 *
 * A test that used one convention for both would pass in Budapest and fail in
 * Chicago, which is the failure this module exists to prevent.
 */

function cat(id: string, over: Partial<CategoryView> = {}): CategoryView {
  return {
    id,
    name: id,
    singleChoice: false,
    isBuiltin: false,
    builtinKey: null,
    position: 0,
    version: 0,
    ...over,
  };
}

function opt(over: Partial<OptionView> = {}): OptionView {
  return {
    id: `o-${Math.random()}`,
    categoryId: "c",
    title: "Untitled",
    description: null,
    url: null,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    startsAt: null,
    endsAt: null,
    externalRef: null,
    status: "LOCKED",
    version: 0,
    proposerId: "u1",
    proposerName: "Ada",
    materialChangedAt: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    lockedByName: "Ada",
    lockedAt: "2026-06-02T10:00:00.000Z",
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
    ...over,
  };
}

/** A trip range as the API serves it: bare calendar days at midnight UTC. */
const trip = (start: string, end: string) => ({
  startDate: `${start}T00:00:00.000Z`,
  endDate: `${end}T00:00:00.000Z`,
});

const stay = cat("stay");
const doing = cat("doing");

function item(category: CategoryView, over: Partial<OptionView>) {
  return { option: opt(over), category };
}

describe("day keys", () => {
  it("reads a trip's date as the day it names, not the day it lands on", () => {
    // Midnight UTC is the previous evening across the Americas. Local getters
    // would call this trip's start the 2nd for most of the western hemisphere;
    // the value is a bare calendar date and has to be read as one.
    expect(tripDayKey("2026-07-03T00:00:00.000Z")).toBe("2026-07-03");
    expect(tripDayKey("2026-07-03T12:00:00.000Z")).toBe("2026-07-03");
    expect(tripDayKey("nonsense")).toBeNull();
  });

  it("bridges a calendar day to the local row that represents it", () => {
    const ms = calendarDayToLocalMs("2026-07-03");
    expect(ms).not.toBeNull();
    // The round trip is the property that matters: whatever zone is running
    // this, the trip's "Jul 3" and an option at 07:15 on Jul 3 share a row.
    expect(localDayKey(ms as number)).toBe("2026-07-03");
    expect(localDayKey(new Date("2026-07-03T07:15").getTime())).toBe(
      "2026-07-03",
    );
    expect(calendarDayToLocalMs("nope")).toBeNull();
  });
});

describe("timelineCandidates", () => {
  const categories = [
    cat("dates", { builtinKey: "DATES", isBuiltin: true }),
    stay,
  ];

  it("leaves the Dates category out — it is the axis, not an event", () => {
    const byCategory = {
      dates: [opt({ title: "Jul 3–10" })],
      stay: [opt({ title: "Hotel Luna" })],
    };
    const got = timelineCandidates(categories, byCategory);
    expect(got.map((c) => c.option.title)).toEqual(["Hotel Luna"]);
  });

  it("takes only locked options unless proposals are asked for", () => {
    const byCategory = {
      dates: [],
      stay: [
        opt({ title: "Hotel Luna" }),
        opt({ title: "Hostel", status: "PROPOSED" }),
      ],
    };
    expect(timelineCandidates(categories, byCategory)).toHaveLength(1);
    const withProposals = timelineCandidates(categories, byCategory, {
      includeProposed: true,
    });
    expect(withProposals.map((c) => c.option.title)).toEqual([
      "Hotel Luna",
      "Hostel",
    ]);
  });

  it("tolerates a category with nothing in the map", () => {
    expect(timelineCandidates(categories, {})).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const range = trip("2026-07-03", "2026-07-10");

  it("frames the spine on the trip's own dates", () => {
    const t = buildTimeline([], range);
    expect(t.axis).toBe("trip");
    expect(t.days).toHaveLength(8);
    expect(t.days[0]?.key).toBe("2026-07-03");
    expect(t.days[7]?.key).toBe("2026-07-10");
    expect(t.days.every((d) => !d.outsideTrip)).toBe(true);
  });

  it("puts an overnight stay in the gutter and counts its nights", () => {
    const t = buildTimeline(
      [
        item(stay, {
          title: "Hotel Luna",
          startsAt: "2026-07-03T15:00",
          endsAt: "2026-07-06T10:00",
        }),
      ],
      range,
    );
    expect(t.spans).toHaveLength(1);
    const span = t.spans[0];
    expect(span?.option.title).toBe("Hotel Luna");
    expect(span?.firstDay).toBe("2026-07-03");
    expect(span?.lastDay).toBe("2026-07-06");
    expect(span?.nights).toBe(3);
    // A span is not also repeated into the days it covers.
    expect(t.days.flatMap((d) => d.entries)).toHaveLength(0);
    expect(t.placedCount).toBe(1);
  });

  it("treats an overnight journey as a span too", () => {
    // The gutter answers "where am I sleeping tonight", and "on a train" is a
    // real answer — which is why this is derived from the dates rather than
    // read off the category.
    const t = buildTimeline(
      [
        item(doing, {
          title: "Night train",
          startsAt: "2026-07-05T23:10",
          endsAt: "2026-07-06T07:30",
        }),
      ],
      range,
    );
    expect(t.spans).toHaveLength(1);
    expect(t.spans[0]?.nights).toBe(1);
  });

  it("puts a same-day thing in its day, earliest first", () => {
    const t = buildTimeline(
      [
        item(doing, {
          title: "Dinner",
          startsAt: "2026-07-04T20:00",
          endsAt: "2026-07-04T22:00",
        }),
        item(doing, {
          title: "Museum",
          startsAt: "2026-07-04T10:00",
          endsAt: "2026-07-04T12:00",
        }),
      ],
      range,
    );
    expect(t.spans).toHaveLength(0);
    const day = t.days.find((d) => d.key === "2026-07-04");
    expect(day?.entries.map((e) => e.option.title)).toEqual([
      "Museum",
      "Dinner",
    ]);
  });

  it("places an option with one date as a point", () => {
    const t = buildTimeline(
      [item(doing, { title: "Flight", startsAt: "2026-07-03T07:15" })],
      range,
    );
    const day = t.days.find((d) => d.key === "2026-07-03");
    expect(day?.entries[0]?.isPoint).toBe(true);
    expect(day?.entries[0]?.start).toBe(day?.entries[0]?.end);
  });

  it("keeps an undated decision instead of dropping it", () => {
    // The failure this guards: a page showing three of eight decisions reads
    // as "this is the trip".
    const t = buildTimeline([item(stay, { title: "Some hotel" })], range);
    expect(t.unscheduled.map((e) => e.option.title)).toEqual(["Some hotel"]);
    expect(t.placedCount).toBe(0);
    expect(t.days.flatMap((d) => d.entries)).toHaveLength(0);
  });

  it("sets aside a booking for the wrong month", () => {
    const t = buildTimeline(
      [
        item(stay, {
          title: "March hotel",
          startsAt: "2026-03-03T15:00",
          endsAt: "2026-03-06T10:00",
        }),
        item(doing, {
          title: "Museum",
          startsAt: "2026-07-04T10:00",
          endsAt: "2026-07-04T12:00",
        }),
      ],
      range,
    );
    expect(t.elsewhere.map((e) => e.option.title)).toEqual(["March hotel"]);
    expect(t.placedCount).toBe(1);
    // Critically, it did not drag the axis back to March.
    expect(t.days).toHaveLength(8);
  });

  it("keeps an overhanging flight on the spine and marks the extra day", () => {
    // A red-eye home leaves on the last day and lands the next. It is not
    // elsewhere, so the axis stretches by the one day it reaches rather than
    // clipping the flight away.
    const t = buildTimeline(
      [
        item(doing, {
          title: "Flight home",
          startsAt: "2026-07-10T23:30",
          endsAt: "2026-07-11T06:10",
        }),
      ],
      range,
    );
    expect(t.elsewhere).toHaveLength(0);
    expect(t.days).toHaveLength(9);
    const extra = t.days[8];
    expect(extra?.key).toBe("2026-07-11");
    expect(extra?.outsideTrip).toBe(true);
    expect(t.days.slice(0, 8).every((d) => !d.outsideTrip)).toBe(true);
  });

  it("derives an axis from the options when the trip has no dates", () => {
    const t = buildTimeline(
      [
        item(doing, {
          title: "A",
          startsAt: "2026-07-04T10:00",
          endsAt: "2026-07-04T12:00",
        }),
        item(doing, {
          title: "B",
          startsAt: "2026-07-06T10:00",
          endsAt: "2026-07-06T12:00",
        }),
      ],
      null,
    );
    expect(t.axis).toBe("derived");
    expect(t.days.map((d) => d.key)).toEqual([
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
    ]);
    // Nothing to be outside of, so nothing is flagged as elsewhere.
    expect(t.elsewhere).toHaveLength(0);
    expect(t.days.every((d) => !d.outsideTrip)).toBe(true);
  });

  it("has no axis at all when there is nothing to draw", () => {
    const t = buildTimeline([], null);
    expect(t.axis).toBe("none");
    expect(t.days).toEqual([]);
    const undatedOnly = buildTimeline([item(stay, { title: "Hotel" })], null);
    expect(undatedOnly.axis).toBe("none");
    expect(undatedOnly.unscheduled).toHaveLength(1);
  });

  it("survives a backwards date pair rather than drawing nothing", () => {
    const t = buildTimeline(
      [
        item(doing, {
          title: "Typo",
          startsAt: "2026-07-06T12:00",
          endsAt: "2026-07-04T10:00",
        }),
      ],
      range,
    );
    expect(t.spans[0]?.firstDay).toBe("2026-07-04");
    expect(t.spans[0]?.lastDay).toBe("2026-07-06");
  });

  it("caps a runaway derived axis instead of laying out a decade", () => {
    // Only reachable without trip dates, where `isOutsideTripDates` cannot
    // sweep up a mistyped year first.
    const t = buildTimeline(
      [
        item(doing, {
          title: "Now",
          startsAt: "2026-07-04T10:00",
          endsAt: "2026-07-04T12:00",
        }),
        item(doing, {
          title: "Typo",
          startsAt: "2036-07-04T10:00",
          endsAt: "2036-07-04T12:00",
        }),
      ],
      null,
    );
    expect(t.days).toHaveLength(MAX_TIMELINE_DAYS);
    expect(t.truncated).toBe(true);
  });
});
