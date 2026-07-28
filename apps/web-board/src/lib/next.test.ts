import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next";

/**
 * The open-redirect clamp on `?next=` (Phase 7.4).
 *
 * `next` is attacker-controllable by construction — the whole point is that a
 * link someone was sent survives the sign-in detour — so this is the one piece
 * of front-end logic where a missing branch is a security bug rather than a
 * cosmetic one. Kept aligned with the API's `safeReturnPath`, which clamps the
 * same value on the Google sign-in round trip.
 */
describe("safeNextPath", () => {
  it("keeps an ordinary internal path", () => {
    expect(safeNextPath("/join/abc123")).toBe("/join/abc123");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/trips/42?tab=chat#top")).toBe(
      "/trips/42?tab=chat#top",
    );
  });

  it("returns null for nothing at all, so callers fall back home", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("refuses anything that could leave the origin", () => {
    for (const hostile of [
      "//evil.example.com", // protocol-relative
      "/\\evil.example.com", // backslash form of the same thing
      "https://evil.example.com",
      "http://evil.example.com",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "evil.example.com", // no leading slash: resolves relative, still not ours
    ]) {
      expect(safeNextPath(hostile), hostile).toBeNull();
    }
  });

  it("does not try to be a sanitiser — a safe prefix is the whole contract", () => {
    // Anything starting with a single `/` is ours by definition; the router
    // decides whether the route exists. This test exists so nobody "improves"
    // the function into a partial escaper.
    expect(safeNextPath("/does/not/exist")).toBe("/does/not/exist");
  });
});
