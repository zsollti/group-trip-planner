import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_THROTTLE,
  REGISTER_THROTTLE,
  budget,
} from "../src/common/throttle-policy.js";

/**
 * The pre-auth limits, and the one thing that can now go wrong with them.
 *
 * Sign-in and registration are per-IP brute-force controls. They became
 * environment-overridable so the browser suite — a dozen serial sign-ins from
 * one address inside a minute — can opt out without the production numbers
 * moving. That is a reasonable trade exactly as long as the *default* is the
 * policy and a bad value cannot quietly raise a limit, which is what this pins.
 *
 * The limiter's runtime behaviour is not tested here on purpose: the throttler
 * keys on the address, and a test that spent the sign-in budget would take
 * every other suite in this process down with it for a minute.
 */

const KEY = "GTP_TEST_THROTTLE_KNOB";

afterEach(() => {
  delete process.env[KEY];
});

describe("throttle policy defaults", () => {
  it("keeps the documented production numbers", () => {
    // If these move, it should be because someone meant to move them.
    assert.equal(REGISTER_THROTTLE.default.limit, 5);
    assert.equal(LOGIN_THROTTLE.default.limit, 10);
    assert.equal(REGISTER_THROTTLE.default.ttl, 60_000);
    assert.equal(LOGIN_THROTTLE.default.ttl, 60_000);
  });
});

describe("budget", () => {
  it("uses the policy value when nothing overrides it", () => {
    assert.equal(budget(KEY, 10, 60_000).default.limit, 10);
  });

  it("takes a deliberate override", () => {
    process.env[KEY] = "500";
    assert.equal(budget(KEY, 10, 60_000).default.limit, 500);
  });

  it("falls back rather than lifting the limit on a bad value", () => {
    // The failure that matters. A typo, an empty string from a shell that
    // exported nothing, or a float must leave the control where the policy put
    // it — never wide open, and never at zero, which would lock everyone out.
    for (const bad of ["", "  ", "abc", "1e3", "10.5", "-1", "0", "NaN"]) {
      process.env[KEY] = bad;
      assert.equal(
        budget(KEY, 10, 60_000).default.limit,
        10,
        `"${bad}" should fall back to the policy value`,
      );
    }
  });

  it("keeps the window the caller asked for", () => {
    process.env[KEY] = "500";
    assert.equal(budget(KEY, 10, 3_600_000).default.ttl, 3_600_000);
  });
});
