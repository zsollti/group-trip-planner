import { describe, expect, it } from "vitest";
import { fitCount, partitionByFit } from "./fitTabs";

/**
 * The overflow arithmetic behind the chat channel switcher. The cases that matter
 * are the ones the old scrolling strip got wrong: a row that *just* fits must not
 * sprout a "＋N" button, a row that doesn't must leave room for one, and there is
 * always at least one item visible.
 */
describe("fitCount", () => {
  it("shows everything when the row fits exactly", () => {
    // 3 × 30 + 2 gaps of 5 = 100.
    expect(fitCount([30, 30, 30], 100, 40, 5)).toBe(3);
  });

  it("reserves room for the overflow trigger once anything spills", () => {
    // Total is 105 > 100, so the trigger (40) and the gap before it (5) come off
    // first, leaving 55: two 30-wide chips would need 65, so only one fits.
    expect(fitCount([30, 30, 30, 30], 100, 40, 5)).toBe(1);
  });

  it("fits as many as the remaining room allows", () => {
    // 200 wide, trigger 40 + gap 5 → 155 available; 4 × 30 + 3 × 5 = 135 fits,
    // a fifth would need 170.
    expect(fitCount([30, 30, 30, 30, 30, 30], 200, 40, 5)).toBe(4);
  });

  it("keeps one item visible even when nothing fits", () => {
    expect(fitCount([500, 500], 100, 40, 5)).toBe(1);
  });

  it("returns 0 for an empty row", () => {
    expect(fitCount([], 100, 40, 5)).toBe(0);
  });

  it("treats an unmeasured container as 'everything fits'", () => {
    // jsdom reports 0 for every width; the graceful answer is the plain row
    // rather than collapsing every channel behind a trigger.
    expect(fitCount([0, 0, 0], 0, 0, 0)).toBe(3);
  });

  it("ignores the gap when there is a single item", () => {
    expect(fitCount([100], 100, 40, 5)).toBe(1);
  });
});

describe("partitionByFit", () => {
  const channels = ["trip", "transport", "stay", "food", "museums"];
  const active = (name: string) => (c: string) => c === name;

  it("hides nothing when everything fits", () => {
    expect(partitionByFit(channels, 5, active("trip"))).toEqual({
      shown: channels,
      hidden: [],
    });
    // A count above the length is still "everything fits".
    expect(partitionByFit(channels, 99, active("trip")).hidden).toEqual([]);
  });

  it("collapses the tail past the fitting count", () => {
    expect(partitionByFit(channels, 2, active("trip"))).toEqual({
      shown: ["trip", "transport"],
      hidden: ["stay", "food", "museums"],
    });
  });

  it("pulls the active channel into the last visible slot", () => {
    // "museums" would have been collapsed; it takes "transport"'s slot, and
    // "transport" collapses in its place — order of the rest is preserved.
    expect(partitionByFit(channels, 2, active("museums"))).toEqual({
      shown: ["trip", "museums"],
      hidden: ["transport", "stay", "food"],
    });
  });

  it("leaves an already-visible active channel where it is", () => {
    expect(partitionByFit(channels, 3, active("transport")).shown).toEqual([
      "trip",
      "transport",
      "stay",
    ]);
  });

  it("copes with no active channel and with an empty row", () => {
    expect(partitionByFit(channels, 1, active("nothing"))).toEqual({
      shown: ["trip"],
      hidden: ["transport", "stay", "food", "museums"],
    });
    expect(partitionByFit([], 0, active("trip"))).toEqual({
      shown: [],
      hidden: [],
    });
  });

  it("does not mutate the list it is given", () => {
    const input = [...channels];
    partitionByFit(input, 2, active("museums"));
    expect(input).toEqual(channels);
  });
});
