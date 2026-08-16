import { describe, expect, it } from "vitest";
import { tripDateStepError } from "./tripDateStep";

/**
 * The create form's dates, checked as they are given.
 *
 * These used to be validated only by the server, at the very end: the dates are
 * held outside the form resolver and shaped at submit, so a start with no end —
 * the obvious way to tap a calendar once and move on — was accepted by two more
 * steps and then rejected on "Create board", as a complaint about a question
 * the reader had stopped thinking about.
 *
 * The rule itself is the shared `planLockedDates`, so what is worth pinning
 * here is the *wrapping*: which answers this step lets through, and that an
 * unanswered optional step is not an error.
 */

/** A day string N days from a fixed "now", so nothing here depends on today. */
const NOW = Date.UTC(2026, 5, 15, 9, 0, 0);
function day(offset: number): string {
  return new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);
}

describe("tripDateStepError", () => {
  it("accepts an unanswered step, because the step is optional", () => {
    // A form that complained about a skipped optional question would be
    // refusing to let it be skipped.
    expect(tripDateStepError("", "", NOW)).toBeNull();
  });

  it("catches a start with no end, the moment it is the answer", () => {
    // The exact case that used to survive to the final button.
    expect(tripDateStepError(day(10), "", NOW)).not.toBeNull();
  });

  it("catches an end with no start", () => {
    expect(tripDateStepError("", day(10), NOW)).not.toBeNull();
  });

  it("accepts a whole range", () => {
    expect(tripDateStepError(day(10), day(17), NOW)).toBeNull();
  });

  it("accepts a single-day trip", () => {
    // Start and end on the same day is a real answer, not a half-filled one.
    expect(tripDateStepError(day(10), day(10), NOW)).toBeNull();
  });

  it("refuses a start that has already been and gone", () => {
    expect(tripDateStepError(day(-3), day(4), NOW)).toMatch(/passed/i);
  });

  it("accepts a start today", () => {
    // The server's rule is date-only in UTC, so a trip starting today is fine
    // even though "now" is nine in the morning.
    expect(tripDateStepError(day(0), day(3), NOW)).toBeNull();
  });

  it("refuses an end before the start", () => {
    expect(tripDateStepError(day(12), day(9), NOW)).toMatch(/before/i);
  });

  it("refuses dates past the planning horizon", () => {
    expect(tripDateStepError(day(10), day(4000), NOW)).not.toBeNull();
  });

  it("speaks about picking dates, not about locking an option", () => {
    // The shared rule's own messages are phrased for locking a Dates option,
    // which is nonsense on a form that has not created a trip yet. Reusing the
    // rule while re-wording it is the whole point of this wrapper.
    const problem = tripDateStepError(day(10), "", NOW)!;
    expect(problem).not.toMatch(/lock/i);
  });
});
