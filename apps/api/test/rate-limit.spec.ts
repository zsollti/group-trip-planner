import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SocketRateLimiter } from "../src/common/socket-rate-limiter.js";
import {
  INVITE_CREATE_THROTTLE,
  LOGIN_THROTTLE,
  MESSAGE_BURST,
  MESSAGE_WINDOW_MS,
  OPTION_CREATE_THROTTLE,
  REGISTER_THROTTLE,
  TRIP_CREATE_THROTTLE,
  UPLOAD_THROTTLE,
  VERIFY_THROTTLE,
} from "../src/common/throttle-policy.js";

/**
 * Rate-limit policy + the socket limiter (Phase 7.1). Pure unit tests: the
 * limiter takes `now` as an argument precisely so window behaviour can be
 * asserted without sleeping.
 */
describe("SocketRateLimiter", () => {
  it("allows exactly the budget, then refuses", () => {
    const limiter = new SocketRateLimiter();
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        limiter.consume("u1", 5, 1000, 0).allowed,
        true,
        `hit ${i + 1} should be allowed`,
      );
    }
    assert.equal(limiter.consume("u1", 5, 1000, 0).allowed, false);
  });

  it("keys budgets separately, so one flooder can't spend another's", () => {
    const limiter = new SocketRateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consume("u1", 5, 1000, 0);
    assert.equal(limiter.consume("u1", 5, 1000, 0).allowed, false);
    assert.equal(limiter.consume("u2", 5, 1000, 0).allowed, true);
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const limiter = new SocketRateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consume("u1", 5, 1000, 0);
    assert.equal(limiter.consume("u1", 5, 1000, 999).allowed, false);
    // At exactly the boundary the window rolls over.
    assert.equal(limiter.consume("u1", 5, 1000, 1000).allowed, true);
  });

  it("reports how long until the window reopens", () => {
    const limiter = new SocketRateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consume("u1", 5, 1000, 0);
    assert.equal(limiter.consume("u1", 5, 1000, 400).retryAfterMs, 600);
  });

  it("counts a refused hit against nothing — refusal is not a top-up", () => {
    const limiter = new SocketRateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.consume("u1", 5, 1000, 0);
    // Hammering while blocked must not extend the block past the window.
    for (let i = 0; i < 50; i += 1) limiter.consume("u1", 5, 1000, 500);
    assert.equal(limiter.consume("u1", 5, 1000, 1000).allowed, true);
  });
});

describe("throttle policy", () => {
  it("keeps pre-auth budgets tighter than authenticated write budgets", () => {
    // The brute-force surface is the pre-auth one, so it must never be the
    // loosest thing in the policy.
    assert.ok(REGISTER_THROTTLE.default.limit <= LOGIN_THROTTLE.default.limit);
    assert.ok(
      LOGIN_THROTTLE.default.limit < OPTION_CREATE_THROTTLE.default.limit,
    );
  });

  it("throttles email-verification token submission at all", () => {
    // Regression guard for the 7.1 finding: /auth/verify previously had no
    // per-route limit, leaving the global IP floor as the only bound on
    // guessing a single-use token.
    assert.ok(VERIFY_THROTTLE.default.limit > 0);
    assert.ok(VERIFY_THROTTLE.default.limit <= 10);
  });

  it("gives every budget a positive limit and window", () => {
    const budgets = {
      REGISTER_THROTTLE,
      LOGIN_THROTTLE,
      VERIFY_THROTTLE,
      UPLOAD_THROTTLE,
      TRIP_CREATE_THROTTLE,
      OPTION_CREATE_THROTTLE,
      INVITE_CREATE_THROTTLE,
    };
    for (const [name, budget] of Object.entries(budgets)) {
      assert.ok(budget.default.limit > 0, `${name} limit`);
      assert.ok(budget.default.ttl > 0, `${name} ttl`);
    }
    assert.ok(MESSAGE_BURST > 0);
    assert.ok(MESSAGE_WINDOW_MS > 0);
  });
});
