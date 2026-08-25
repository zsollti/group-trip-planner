import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESETS,
  avatarPresetOf,
  avatarPresetUrl,
  isAvatarPresetUrl,
} from "@gtp/types";
import { AVATAR_PRESET_NAME } from "./avatarPresets";

/**
 * The `preset:` scheme, which is the price of not adding a second column.
 *
 * `avatarUrl` carries two different kinds of thing now, so the one function
 * that tells them apart has to be exactly right — a false positive renders a
 * broken image, and a false negative renders an empty circle.
 */
describe("avatarPresetOf", () => {
  it("round-trips every mark", () => {
    for (const preset of AVATAR_PRESETS) {
      expect(avatarPresetOf(avatarPresetUrl(preset))).toBe(preset);
    }
  });

  it("says nothing about an uploaded picture", () => {
    for (const url of [
      "https://trips.example/uploads/abc.webp",
      "/uploads/abc.webp",
      "",
      null,
      undefined,
    ]) {
      expect(avatarPresetOf(url)).toBeNull();
    }
  });

  it("falls back to initials on a key it does not know", () => {
    // The safety property that makes the list changeable: a value written by
    // another build renders as initials, not as an empty circle.
    expect(avatarPresetOf("preset:hovercraft")).toBeNull();
    expect(avatarPresetOf("preset:")).toBeNull();
  });
});

describe("isAvatarPresetUrl", () => {
  it("recognises a mark this build cannot draw", () => {
    // The distinction that keeps a stale key out of an <img>: it is still not
    // an address, whatever else it is. Asking only "which mark?" and getting
    // null read as "an upload", which renders a broken image.
    expect(isAvatarPresetUrl("preset:hovercraft")).toBe(true);
    expect(avatarPresetOf("preset:hovercraft")).toBeNull();
  });

  it("agrees with itself on everything else", () => {
    for (const preset of AVATAR_PRESETS) {
      expect(isAvatarPresetUrl(avatarPresetUrl(preset))).toBe(true);
    }
    for (const url of ["https://x.test/a.webp", "/uploads/a.webp", "", null]) {
      expect(isAvatarPresetUrl(url)).toBe(false);
    }
  });
});

describe("the marks themselves", () => {
  it("draws and names every key the contract offers", () => {
    // The contract owns the keys and the board owns the pictures, so a key
    // added on one side and forgotten on the other is exactly the seam that
    // would ship an avatar with nothing in it.
    for (const preset of AVATAR_PRESETS) {
      expect(AVATAR_PRESET_NAME[preset]).toBeTruthy();
    }
    expect(Object.keys(AVATAR_PRESET_NAME).sort()).toEqual(
      [...AVATAR_PRESETS].sort(),
    );
  });
});
