import { describe, expect, it } from "vitest";
import { ANCHOR_GAP, anchorPanel, type Rect } from "./anchoredPosition";

const viewport = { width: 1000, height: 800 };
const panel = { width: 200, height: 120 };
const trigger = (over: Partial<Rect> = {}): Rect => ({
  top: 300,
  left: 400,
  width: 40,
  height: 24,
  ...over,
});

describe("anchoring a panel to its trigger", () => {
  it("hangs below the trigger, one gap down", () => {
    const at = anchorPanel(trigger(), panel, viewport, {
      place: "below",
      align: "left",
    });
    expect(at.top).toBe(300 + 24 + ANCHOR_GAP);
  });

  it("sits above the trigger when asked to", () => {
    const at = anchorPanel(trigger(), panel, viewport, {
      place: "above",
      align: "left",
    });
    expect(at.top).toBe(300 - 120 - ANCHOR_GAP);
  });

  it("keeps the left edges flush", () => {
    const at = anchorPanel(trigger(), panel, viewport, {
      place: "below",
      align: "left",
    });
    expect(at.left).toBe(400);
  });

  it("keeps the right edges flush", () => {
    const at = anchorPanel(trigger(), panel, viewport, {
      place: "below",
      align: "right",
    });
    expect(at.left).toBe(400 + 40 - 200);
  });

  it("flips above when there is no room below", () => {
    const at = anchorPanel(trigger({ top: 760 }), panel, viewport, {
      place: "below",
      align: "left",
    });
    expect(at.top).toBe(760 - 120 - ANCHOR_GAP);
  });

  it("flips below when there is no room above", () => {
    const at = anchorPanel(trigger({ top: 10 }), panel, viewport, {
      place: "above",
      align: "left",
    });
    expect(at.top).toBe(10 + 24 + ANCHOR_GAP);
  });

  it("stays on screen when the trigger is against the right edge", () => {
    const at = anchorPanel(trigger({ left: 980 }), panel, viewport, {
      place: "below",
      align: "left",
    });
    expect(at.left).toBeLessThanOrEqual(viewport.width - panel.width);
    expect(at.left).toBeGreaterThanOrEqual(0);
  });

  it("stays on screen when the trigger is against the left edge", () => {
    const at = anchorPanel(trigger({ left: 2 }), panel, viewport, {
      place: "below",
      align: "right",
    });
    expect(at.left).toBeGreaterThanOrEqual(0);
  });

  it("keeps the top on screen when the panel is taller than the window", () => {
    const at = anchorPanel(
      trigger({ top: 400 }),
      { width: 200, height: 900 },
      viewport,
      { place: "below", align: "left" },
    );
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeLessThan(viewport.height);
  });

  it("picks the roomier side when neither fits", () => {
    // 700 tall in an 800 window: below the trigger there are 380px, above 400.
    const tall = { width: 200, height: 700 };
    const at = anchorPanel(trigger({ top: 400 }), tall, viewport, {
      place: "below",
      align: "left",
    });
    // Above is roomier by 20px, so it goes above and is then clamped on screen.
    expect(at.top).toBeLessThan(400);
  });
});
