import { describe, expect, it } from "vitest";
import {
  centreFontRem,
  centreLabelRem,
  HOLE_FRACTION,
  LABEL_PX,
} from "./donutCentre";

/**
 * The figure has to fit the hole.
 *
 * Worth testing as arithmetic because the failure is silent: text that does not
 * fit still renders, it just renders over the ring, and every DOM assertion
 * about "the total is shown" keeps passing while the chart is unreadable. This
 * is the bug the fixed 1.15rem centre had for every trip priced in forint.
 */

/** The donut's hole at its rendered size — 148px box, 66% hole. */
const HOLE = 148 * HOLE_FRACTION;

/** Roughly what a string occupies at a size, in px, by the module's own model. */
function widthAt(text: string, rem: number): number {
  return text.length * 0.62 * rem * 16;
}

describe("centreFontRem", () => {
  it("keeps a short figure at the size the centre was designed for", () => {
    // `€2,140` fitted before and must not shrink now — the fix is for the long
    // case, and quietly shrinking every other trip's total would be a
    // regression dressed as one.
    expect(centreFontRem("€2,140", HOLE)).toBe(1.15);
  });

  it("shrinks a six-figure forint total enough to fit", () => {
    // The case that motivated the whole thing: grouped thousands plus a
    // suffix, which is every trip priced in HUF.
    const huf = "1 234 567 Ft";
    const rem = centreFontRem(huf, HOLE);
    expect(rem).toBeLessThan(1.15);
    expect(widthAt(huf, rem)).toBeLessThanOrEqual(HOLE);
  });

  it("fits every length it will realistically be handed", () => {
    const samples = [
      "€0",
      "€2,140",
      "≈ €2,140",
      "12 345 Ft",
      "1 234 567 Ft",
      "≈ 1 234 567 Ft",
      "1 234 567,89 zł",
    ];
    for (const text of samples) {
      const rem = centreFontRem(text, HOLE);
      expect(
        widthAt(text, rem),
        `${text} at ${rem}rem overflows the hole`,
      ).toBeLessThanOrEqual(HOLE);
    }
  });

  it("stops shrinking rather than becoming unreadable", () => {
    // A pathological string should bottom out, not vanish. Past the floor the
    // right answer is a clipped figure, not a 3px one.
    expect(centreFontRem("x".repeat(200), HOLE)).toBe(0.62);
  });

  it("never grows past the design size, however short the text", () => {
    expect(centreFontRem("€1", HOLE)).toBe(1.15);
    expect(centreFontRem("", HOLE)).toBe(1.15);
  });

  it("is continuous, so one more character never drops it a visible step", () => {
    // A stepped scale would make the total change size as a trip crosses a
    // round number, which reads as a rendering bug rather than as fitting. The
    // property is per character: each one costs a little, and no length is a
    // cliff.
    for (let n = 5; n < 20; n++) {
      const step =
        centreFontRem("x".repeat(n), HOLE) -
        centreFontRem("x".repeat(n + 1), HOLE);
      // 0.15rem is about 2px at the default root size — the largest step the
      // curve takes, at its short end, and small enough not to read as the
      // figure changing size. A lookup table would blow straight past it.
      expect(step, `${n} → ${n + 1} characters jumps`).toBeLessThan(0.15);
      expect(step, `${n} → ${n + 1} characters grows`).toBeGreaterThanOrEqual(
        0,
      );
    }
  });
});

/**
 * And the line above it has to fit too — against a narrower measure.
 *
 * The centre is a square inset to the hole's diameter; the hole is a circle.
 * The lane name sits above the widest point, so a name that fits the square can
 * still run into the wedges, which is what "Accommodation" did.
 */
describe("centreLabelRem", () => {
  /** The module's own model of how wide a label is, in px. */
  function labelWidth(text: string, rem: number): number {
    return text.length * 0.56 * rem * 16;
  }

  it("leaves a short lane name at the size it was designed for", () => {
    expect(centreLabelRem("Food", LABEL_PX)).toBe(0.6);
  });

  it("fits the name that ran into the ring", () => {
    const rem = centreLabelRem("Accommodation", LABEL_PX);
    expect(labelWidth("Accommodation", rem)).toBeLessThanOrEqual(LABEL_PX);
  });

  it("fits every lane the board seeds, and the hole's own two labels", () => {
    const samples = [
      "Accommodation",
      "Transport",
      "Activities",
      "Food",
      "Still to spend",
      "Over budget",
      "Szállás",
      "Tevékenységek",
    ];
    for (const text of samples) {
      const rem = centreLabelRem(text, LABEL_PX);
      expect(
        labelWidth(text, rem),
        `${text} at ${rem}rem overflows the label line`,
      ).toBeLessThanOrEqual(LABEL_PX);
    }
  });

  it("stops shrinking rather than becoming unreadable", () => {
    // A category name has no length limit worth designing for. Past the floor
    // the honest answer is an ellipsis, which the stylesheet supplies.
    expect(centreLabelRem("x".repeat(80), LABEL_PX)).toBe(0.46);
  });

  it("measures against less than the hole's full width", () => {
    // The number that makes the whole thing work: a label sized against the
    // diameter is a label sized against a width it does not have.
    expect(LABEL_PX).toBeLessThan(Math.round(148 * HOLE_FRACTION));
  });
});
