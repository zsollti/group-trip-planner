import { describe, expect, it } from "vitest";
import { calendarDetail } from "./calendarDetail";

/**
 * How much a calendar block says, by how tall it is.
 *
 * The failure mode this guards is not a crash but a plausible lie: a block that
 * had room for the cost and did not show it looks exactly like an option with
 * no price. Nothing in the DOM distinguishes the two, so the rule is checked
 * here instead.
 */
describe("calendarDetail", () => {
  it("puts a half-hour block's title and time on one line", () => {
    const d = calendarDetail(30);
    expect(d.tight).toBe(true);
    expect(d.showCost).toBe(false);
    expect(d.showNote).toBe(false);
  });

  it("keeps an hour to the title and the time", () => {
    // Four lines' worth of height, three of which the title and time and
    // their own breathing room already claim.
    const d = calendarDetail(60);
    expect(d.tight).toBe(false);
    expect(d.showCost).toBe(true);
    expect(d.showNote).toBe(false);
  });

  it("adds the cost before it adds the note", () => {
    // The ordering that makes the feature worth having: money first, because
    // it is short and it is what the itinerary is being read to weigh.
    const heights = [60, 75, 90, 120, 240];
    for (const h of heights) {
      const d = calendarDetail(h);
      if (d.showNote) expect(d.showCost).toBe(true);
    }
  });

  it("shows the note from two hours, and not before", () => {
    // Room for two lines is not the same question as worth two lines: a
    // 90-minute lunch fitted a note and turned into a paragraph in a column of
    // otherwise scannable blocks. One line of a note reads as broken rather
    // than as an excerpt, and a short block's note reads as clutter.
    expect(calendarDetail(90).showNote).toBe(false);
    expect(calendarDetail(119).showNote).toBe(false);
    expect(calendarDetail(120).showNote).toBe(true);
    expect(calendarDetail(120).noteLines).toBeGreaterThanOrEqual(2);
  });

  it("shows the price from an hour, and not before", () => {
    // Under an hour a block has the title and its time and nothing spare.
    expect(calendarDetail(45).showCost).toBe(false);
    expect(calendarDetail(59).showCost).toBe(false);
    expect(calendarDetail(60).showCost).toBe(true);
  });

  it("stops growing the note on a very long block", () => {
    // An eight-hour hike should not become a wall of prose in the grid; the
    // option detail is one click away.
    expect(calendarDetail(480).noteLines).toBeLessThanOrEqual(4);
  });

  it("never claims lines a block does not have", () => {
    for (let h = 5; h <= 600; h += 5) {
      const d = calendarDetail(h);
      const claimed = 2 + (d.showCost ? 1 : 0) + d.noteLines;
      expect(claimed * 15, `at ${h} minutes`).toBeLessThanOrEqual(
        Math.max(h, 30),
      );
    }
  });

  it("is monotonic — a taller block never says less", () => {
    let seen = 0;
    for (let h = 15; h <= 600; h += 15) {
      const d = calendarDetail(h);
      const said = (d.showCost ? 1 : 0) + d.noteLines;
      expect(
        said,
        `${h} minutes said less than a shorter block`,
      ).toBeGreaterThanOrEqual(seen);
      seen = said;
    }
  });
});
