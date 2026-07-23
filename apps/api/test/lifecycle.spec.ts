import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expiryFromEndDate,
  fallbackExpiresAt,
  isTripFrozen,
  planLockedDates,
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
    assert.equal(
      isTripFrozen("ACTIVE", "2026-07-23T11:59:59.000Z", now),
      true,
    );
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
    const plan = planLockedDates(null, "2026-08-08T00:00:00.000Z", now, horizon);
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
