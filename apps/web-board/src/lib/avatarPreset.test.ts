import { describe, expect, it } from "vitest";
import {
  AVATAR_COLOURS,
  AVATAR_PRESETS,
  avatarColourOf,
  avatarPresetOf,
  avatarPresetUrl,
  isAvatarPresetUrl,
  randomAvatarLook,
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

/**
 * The colour half of the same string.
 *
 * `preset:tent@SKY` has to keep answering "tent" to every caller that only ever
 * asked which mark, and `preset:tent` — every drawn avatar stored before
 * colours existed — has to keep working untouched. Those two properties are the
 * whole of the migration, so they are what is pinned here.
 */
describe("avatarColourOf", () => {
  it("round-trips every colour, without disturbing the mark", () => {
    for (const colour of AVATAR_COLOURS) {
      const url = avatarPresetUrl("tent", colour);
      expect(avatarColourOf(url)).toBe(colour);
      expect(avatarPresetOf(url)).toBe("tent");
    }
  });

  it("reads a mark stored before colours existed", () => {
    // The one that cannot be allowed to regress: these are live rows.
    expect(avatarPresetOf("preset:compass")).toBe("compass");
    expect(avatarColourOf("preset:compass")).toBeNull();
    // And the builder still writes exactly that shape when given no colour, so
    // a caller with nothing to say does not invent a colour by accident.
    expect(avatarPresetUrl("compass")).toBe("preset:compass");
    expect(avatarPresetUrl("compass", null)).toBe("preset:compass");
  });

  it("falls back rather than trusting a colour it does not know", () => {
    // Same safety property the marks have, for the same reason: a value from
    // another build draws in the generated hue instead of nothing at all.
    expect(avatarColourOf("preset:tent@CHARTREUSE")).toBeNull();
    expect(avatarPresetOf("preset:tent@CHARTREUSE")).toBe("tent");
    expect(avatarColourOf("https://x.test/a.webp")).toBeNull();
  });
});

describe("randomAvatarLook", () => {
  it("only ever names things the contract knows", () => {
    // It runs on every registration, so a look it cannot draw is an avatar
    // nobody can see — and it would be seen first by a stranger.
    for (let i = 0; i < 200; i += 1) {
      const { preset, colour } = randomAvatarLook();
      expect(AVATAR_PRESETS).toContain(preset);
      expect(AVATAR_COLOURS).toContain(colour);
      // And what it produces has to survive the round trip it was made for.
      const url = avatarPresetUrl(preset, colour);
      expect(avatarPresetOf(url)).toBe(preset);
      expect(avatarColourOf(url)).toBe(colour);
    }
  });

  it("takes its randomness from where it is told", () => {
    const look = randomAvatarLook(() => 0);
    expect(look.preset).toBe(AVATAR_PRESETS[0]);
    expect(look.colour).toBe(AVATAR_COLOURS[0]);
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
