import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_LENGTH, isTruncated, truncateName } from "./truncate";

/**
 * The display rule is "15 characters, then an ellipsis". What's worth pinning is
 * the boundary (a name of exactly 15 is not touched), that the ellipsis is one
 * character rather than three dots, and that `isTruncated` agrees with
 * `truncateName` — components use it to decide whether a tooltip is owed.
 */
describe("truncateName", () => {
  it("leaves a name at or under the limit untouched", () => {
    expect(truncateName("Transport")).toBe("Transport");
    // Exactly 15 — the boundary is inclusive, so no ellipsis.
    const exact = "Museums and gal";
    expect(exact).toHaveLength(DISPLAY_NAME_LENGTH);
    expect(truncateName(exact)).toBe(exact);
  });

  it("cuts after the 15th character and appends a single ellipsis", () => {
    expect(truncateName("Museums and galleries")).toBe("Museums and gal…");
    // One ellipsis character, not three periods.
    expect(truncateName("Museums and galleries")).not.toContain("...");
  });

  it("trims a trailing space so the ellipsis hugs the last word", () => {
    // Cutting "Museums and  extra" at 15 lands on a space.
    expect(truncateName("Museums and     x")).toBe("Museums and…");
  });

  it("honours an explicit limit", () => {
    expect(truncateName("Transport", 4)).toBe("Tran…");
  });

  it("handles the empty string", () => {
    expect(truncateName("")).toBe("");
  });

  it("isTruncated agrees with whether truncateName shortened anything", () => {
    for (const name of [
      "",
      "Stay",
      "Museums and gal",
      "Museums and galleries",
    ]) {
      expect(isTruncated(name)).toBe(truncateName(name) !== name);
    }
  });
});
