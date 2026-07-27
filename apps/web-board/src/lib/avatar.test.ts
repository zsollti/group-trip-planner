import { describe, expect, it } from "vitest";
import { avatarHue, initialsOf } from "./avatar";

describe("initialsOf", () => {
  it("takes first and last initials from a full name", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("  ada   lovelace  ")).toBe("AL");
  });

  it("takes one initial from a single name", () => {
    expect(initialsOf("Ada")).toBe("A");
  });

  it("skips the middle of a longer name", () => {
    expect(initialsOf("Ada King Lovelace")).toBe("AL");
  });

  it("falls back to ? for an empty name", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("doesn't split a multi-byte character in half", () => {
    // Indexing by code unit rather than code point would yield a lone
    // surrogate here and render as a replacement glyph.
    expect(initialsOf("🎿 Snowboarder")).toBe("🎿S");
    expect(initialsOf("Ólafur Árnason")).toBe("ÓÁ");
  });
});

describe("avatarHue", () => {
  it("is deterministic — the same person keeps their colour", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(avatarHue(id)).toBe(avatarHue(id));
  });

  it("always lands in the valid hue range", () => {
    for (const seed of ["", "a", "Ada Lovelace", "x".repeat(200)]) {
      const hue = avatarHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it("separates different people", () => {
    // Not a guarantee for arbitrary input, but these should not collide.
    expect(avatarHue("user-a")).not.toBe(avatarHue("user-b"));
  });
});
