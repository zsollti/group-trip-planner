import { describe, expect, it } from "vitest";
import {
  boardTourSteps,
  dashboardTourSteps,
  placeBubble,
  visibleSteps,
  TOUR_GAP,
  type Rect,
} from "./tour";

/**
 * The two parts of the tour that are arithmetic rather than a document: where
 * the bubble goes, and which steps run at all.
 *
 * Both live here rather than in the component for the usual reason — jsdom
 * measures nothing, so a placement asserted through a render would be asserting
 * against a viewport of zeroes and every case would "pass".
 */

const VIEWPORT = { width: 1200, height: 800 };
const BUBBLE = { width: 320, height: 180 };

/** A rect, written the way a reader thinks about one. */
const at = (left: number, top: number, width = 100, height = 40): Rect => ({
  left,
  top,
  width,
  height,
});

describe("placing the bubble", () => {
  it("puts it under the thing it points at, centred on it", () => {
    const place = placeBubble(at(500, 100), BUBBLE, VIEWPORT);
    expect(place.side).toBe("bottom");
    expect(place.top).toBe(100 + 40 + TOUR_GAP);
    // Centred: anchor centre 550, bubble half-width 160.
    expect(place.left).toBe(390);
  });

  it("goes above when there is no room below", () => {
    const place = placeBubble(at(500, 700), BUBBLE, VIEWPORT);
    expect(place.side).toBe("top");
    expect(place.top).toBe(700 - 180 - TOUR_GAP);
  });

  it("goes beside when there is room neither below nor above", () => {
    // A tall anchor filling the viewport — a lane, on a short window.
    const place = placeBubble(at(100, 0, 200, 800), BUBBLE, VIEWPORT);
    expect(place.side).toBe("right");
    expect(place.left).toBe(100 + 200 + TOUR_GAP);
    // Centred on the anchor vertically, so it does not hang off a tall column.
    expect(place.top).toBe(400 - 90);
  });

  it("takes the left when the right is off screen too", () => {
    const place = placeBubble(at(900, 0, 300, 800), BUBBLE, VIEWPORT);
    expect(place.side).toBe("left");
    expect(place.left).toBe(900 - 320 - TOUR_GAP);
  });

  /**
   * The property that matters more than any particular side: the bubble is
   * always reachable. Its buttons are the only way to advance or leave the
   * tour, so one placed half off screen is a trap, not a cosmetic problem.
   */
  it("never leaves the viewport, wherever the anchor is", () => {
    const anchors: Rect[] = [
      at(0, 0),
      at(1150, 0),
      at(1150, 780),
      at(0, 780),
      at(-200, -50),
      at(2000, 2000),
      at(0, 0, 1200, 800),
    ];
    for (const anchor of anchors) {
      const place = placeBubble(anchor, BUBBLE, VIEWPORT);
      expect(place.left).toBeGreaterThanOrEqual(0);
      expect(place.top).toBeGreaterThanOrEqual(0);
      expect(place.left + BUBBLE.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(place.top + BUBBLE.height).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });

  it("keeps the top of the bubble visible when it is taller than the screen", () => {
    // A short phone in landscape. Clamping naively inverts the range here and
    // pins the bubble to the *bottom* edge, taking its buttons off screen —
    // the top is where the words and the escape hatch are.
    const place = placeBubble(
      at(100, 100),
      { width: 320, height: 900 },
      { width: 400, height: 400 },
    );
    expect(place.top).toBe(TOUR_GAP);
  });
});

describe("choosing which steps run", () => {
  /**
   * The rule the whole tour rests on. A Guest has no Invite button and no chat,
   * an empty board has no card to vote on, a narrow window has no rail — and a
   * step pointing at something absent strands the reader on a panel that can
   * never advance.
   */
  it("drops every step whose anchor is not on the page", () => {
    const present = new Set(["lane", "propose", "cost"]);
    const steps = visibleSteps(boardTourSteps(), (a) => present.has(a));
    expect(steps.map((s) => s.id)).toEqual(["lane", "propose", "cost"]);
  });

  it("keeps the order they were written in", () => {
    const all = boardTourSteps();
    const steps = visibleSteps(all, () => true);
    expect(steps.map((s) => s.id)).toEqual(all.map((s) => s.id));
  });

  it("returns nothing rather than throwing when the page is empty", () => {
    expect(visibleSteps(boardTourSteps(), () => false)).toEqual([]);
  });

  it("gives every step a distinct id and a non-empty anchor", () => {
    for (const steps of [boardTourSteps(), dashboardTourSteps()]) {
      const ids = steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of steps) {
        expect(step.anchor).not.toBe("");
        expect(step.title).not.toBe("");
        expect(step.body).not.toBe("");
      }
    }
  });
});
