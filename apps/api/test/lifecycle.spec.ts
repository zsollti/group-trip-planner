import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expiryFromEndDate,
  fallbackExpiresAt,
  isOutsideTripDates,
  isTripFrozen,
  planLockedDates,
  showsOutsideDatesHint,
  tripDateRange,
} from "@gtp/types";

/**
 * Pure lifecycle + Dates write-back rules (no DB, no clock): the freeze
 * predicate, the two expiry computations, and the lock-time date validation
 * (FR-8/9/25). `nowMs`/`horizonDays` are injected so every branch is testable.
 */
describe("isTripFrozen", () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");

  it("is frozen when persisted as History regardless of expiry", () => {
    assert.equal(
      isTripFrozen("HISTORY", "2099-01-01T00:00:00.000Z", now),
      true,
    );
  });

  it("is frozen when now is past expiresAt even if still Active", () => {
    assert.equal(isTripFrozen("ACTIVE", "2026-07-23T11:59:59.000Z", now), true);
  });

  it("is active before expiresAt", () => {
    assert.equal(
      isTripFrozen("ACTIVE", "2026-07-24T00:00:00.000Z", now),
      false,
    );
  });
});

describe("expiry computations", () => {
  it("fallback expiry is created + 1 year", () => {
    assert.equal(
      fallbackExpiresAt(Date.parse("2026-07-23T00:00:00.000Z")),
      "2027-07-23T00:00:00.000Z",
    );
  });

  it("locked expiry is end date + 1 month", () => {
    assert.equal(
      expiryFromEndDate(Date.parse("2026-08-10T00:00:00.000Z")),
      "2026-09-10T00:00:00.000Z",
    );
  });
});

describe("planLockedDates", () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");
  const horizon = 365;

  it("accepts valid future dates and computes end + 1 month expiry", () => {
    const plan = planLockedDates(
      "2026-08-01T00:00:00.000Z",
      "2026-08-08T00:00:00.000Z",
      now,
      horizon,
    );
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.startDate, "2026-08-01T00:00:00.000Z");
      assert.equal(plan.expiresAt, "2026-09-08T00:00:00.000Z");
    }
  });

  it("rejects a missing date set", () => {
    const plan = planLockedDates(
      null,
      "2026-08-08T00:00:00.000Z",
      now,
      horizon,
    );
    assert.deepEqual(plan, { ok: false, reason: "NO_DATES" });
  });

  it("rejects an end before start", () => {
    const plan = planLockedDates(
      "2026-08-08T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      now,
      horizon,
    );
    assert.deepEqual(plan, { ok: false, reason: "END_BEFORE_START" });
  });

  it("rejects a start in the past", () => {
    const plan = planLockedDates(
      "2026-07-20T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
      now,
      horizon,
    );
    assert.deepEqual(plan, { ok: false, reason: "PAST" });
  });

  it("allows a start earlier today (date-only, not past)", () => {
    const plan = planLockedDates(
      "2026-07-23T06:00:00.000Z", // same UTC day as now, before noon
      "2026-07-25T00:00:00.000Z",
      now,
      horizon,
    );
    assert.equal(plan.ok, true);
  });

  it("rejects an end beyond the horizon", () => {
    const plan = planLockedDates(
      "2026-08-01T00:00:00.000Z",
      "2027-09-01T00:00:00.000Z", // > 365 days out
      now,
      horizon,
    );
    assert.deepEqual(plan, { ok: false, reason: "OVER_HORIZON" });
  });
});

/**
 * The advisory "this option is not on this trip" rule. Once a trip's dates are
 * settled an option's own dates mean *when within the trip*, and this is what
 * the card reads to say so. Nothing rejects on it, which is why the threshold
 * is set where it is: a false positive on a correct option teaches people to
 * ignore the warning.
 */
describe("tripDateRange", () => {
  it("is null unless both ends are set", () => {
    assert.equal(tripDateRange({ startDate: null, endDate: null }), null);
    assert.equal(
      tripDateRange({ startDate: "2026-09-06T12:00:00.000Z", endDate: null }),
      null,
    );
    assert.equal(
      tripDateRange({ startDate: null, endDate: "2026-09-13T12:00:00.000Z" }),
      null,
    );
  });

  it("is the range when the trip has settled its dates", () => {
    assert.deepEqual(
      tripDateRange({
        startDate: "2026-09-06T12:00:00.000Z",
        endDate: "2026-09-13T12:00:00.000Z",
      }),
      {
        startDate: "2026-09-06T12:00:00.000Z",
        endDate: "2026-09-13T12:00:00.000Z",
      },
    );
  });
});

describe("isOutsideTripDates", () => {
  const range = {
    startDate: "2026-09-06T12:00:00.000Z",
    endDate: "2026-09-13T12:00:00.000Z",
  };
  const option = (startsAt: string | null, endsAt: string | null = null) => ({
    startsAt,
    endsAt,
  });

  it("says nothing while the trip has no settled dates", () => {
    // The whole point is "not on *this* trip" — with no trip dates there is
    // nothing to be outside of, and every option would be flagged.
    assert.equal(
      isOutsideTripDates(option("2027-01-01T09:00:00.000Z"), null),
      false,
    );
  });

  it("says nothing about an option with no dates of its own", () => {
    assert.equal(isOutsideTripDates(option(null, null), range), false);
  });

  it("flags a booking made for the wrong month", () => {
    // The case this exists for.
    assert.equal(
      isOutsideTripDates(
        option("2026-03-06T14:00:00.000Z", "2026-03-09T10:00:00.000Z"),
        range,
      ),
      true,
    );
    assert.equal(
      isOutsideTripDates(option("2026-12-24T09:00:00.000Z"), range),
      true,
    );
  });

  it("stays quiet for anything overlapping the trip at all", () => {
    // Inside; starting before and running in; starting during and running out.
    assert.equal(
      isOutsideTripDates(option("2026-09-08T09:00:00.000Z"), range),
      false,
    );
    assert.equal(
      isOutsideTripDates(
        option("2026-09-01T09:00:00.000Z", "2026-09-07T09:00:00.000Z"),
        range,
      ),
      false,
    );
    assert.equal(
      isOutsideTripDates(
        option("2026-09-12T09:00:00.000Z", "2026-09-20T09:00:00.000Z"),
        range,
      ),
      false,
    );
  });

  it("gives a day of slack either side, for the flight home and the checkout", () => {
    // A red-eye leaves on the last day and lands the next; a checkout is the
    // morning after the last night. Both are correct and neither is flagged.
    assert.equal(
      isOutsideTripDates(
        option("2026-09-13T23:30:00.000Z", "2026-09-14T06:10:00.000Z"),
        range,
      ),
      false,
    );
    // The trip's own dates name bare calendar days while an option's are a
    // local wall-clock instant, so an activity on the first morning can sit
    // hours before the trip's start instant without being anywhere else.
    assert.equal(
      isOutsideTripDates(option("2026-09-06T06:00:00.000Z"), range),
      false,
    );
    // Past the slack, it is a different week.
    assert.equal(
      isOutsideTripDates(option("2026-09-16T09:00:00.000Z"), range),
      true,
    );
  });

  it("gives the last day its length, for an evening west of Greenwich", () => {
    // The range as the API actually serves it: `Trip.startDate`/`endDate` are
    // `@db.Date`, so they come back as midnight UTC — the *start* of the last
    // day. Read literally that leaves no slack at all on the end side, and a
    // 9pm dinner on the last day in New York is a different week.
    const served = {
      startDate: "2026-07-03T00:00:00.000Z",
      endDate: "2026-07-10T00:00:00.000Z",
    };
    assert.equal(
      isOutsideTripDates(option("2026-07-10T21:00:00-04:00"), served),
      false,
    );
    assert.equal(
      isOutsideTripDates(
        option("2026-07-10T23:30:00-04:00", "2026-07-11T06:10:00-04:00"),
        served,
      ),
      false,
    );
    // Still a different week, which is the whole point of the check.
    assert.equal(
      isOutsideTripDates(option("2026-07-14T09:00:00.000Z"), served),
      true,
    );
  });

  it("treats a single date as a point, from whichever end is set", () => {
    assert.equal(
      isOutsideTripDates(option(null, "2026-03-09T10:00:00.000Z"), range),
      true,
    );
    assert.equal(
      isOutsideTripDates(option(null, "2026-09-09T10:00:00.000Z"), range),
      false,
    );
  });

  it("says nothing when a date cannot be parsed", () => {
    // Advisory output must never turn a bad value into a false accusation.
    assert.equal(isOutsideTripDates(option("not a date"), range), false);
    assert.equal(
      isOutsideTripDates(option("2026-09-09T10:00:00.000Z"), {
        startDate: "nonsense",
        endDate: "2026-09-13T12:00:00.000Z",
      }),
      false,
    );
  });
});

describe("showsOutsideDatesHint", () => {
  // The range a locked Dates option would have written back: the trip now runs
  // the week of the 6th because somebody chose that week.
  const range = {
    startDate: "2026-09-06T00:00:00.000Z",
    endDate: "2026-09-13T00:00:00.000Z",
  };
  // The rival proposal nobody picked — a fortnight later, still on the board.
  const rival = {
    startsAt: "2026-09-20T00:00:00.000Z",
    endsAt: "2026-09-27T00:00:00.000Z",
  };

  it("never tells a Dates option it is outside the dates it proposes", () => {
    // The circularity this rule exists for. Locking one date option writes the
    // trip's range, so from that moment every alternative in the lane fails the
    // geometric test — and saying so is noise on the one lane where changing
    // your mind means reading the alternatives.
    assert.equal(isOutsideTripDates(rival, range), true);
    assert.equal(
      showsOutsideDatesHint(rival, range, { builtinKey: "DATES" }),
      false,
    );
  });

  it("still flags the hotel booked for the wrong fortnight", () => {
    // Same dates, a different lane: here the option means "when *within* the
    // trip", so falling entirely outside it is real news.
    for (const builtinKey of ["ACCOMMODATION", "TRANSPORT", null] as const) {
      assert.equal(showsOutsideDatesHint(rival, range, { builtinKey }), true);
    }
  });

  it("agrees with the geometry everywhere it is asked", () => {
    // Only the Dates lane is special-cased; nothing else about the predicate
    // changes, including the day of slack and the unsettled-trip case.
    const during = { startsAt: "2026-09-08T09:00:00.000Z", endsAt: null };
    assert.equal(
      showsOutsideDatesHint(during, range, { builtinKey: "ACTIVITIES" }),
      false,
    );
    assert.equal(
      showsOutsideDatesHint(rival, null, { builtinKey: null }),
      false,
    );
  });
});
