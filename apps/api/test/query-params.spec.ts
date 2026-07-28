import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import {
  parseCursor,
  parseLimit,
  requireIdParam,
} from "../src/common/query-params.js";

/**
 * The query-string boundary (Phase 7.2, unit-tested in 7.4).
 *
 * These three functions are the only thing standing between a hand-typed URL and
 * Prisma. Every route that pages uses them, so their edges are exercised
 * constantly and asserted nowhere — the e2e suites check the routes' happy paths,
 * which cannot tell a real validation from a lucky cast. Hence direct tests.
 *
 * The distinction they encode: **malformed is refused, out-of-range is not.** A
 * cursor that isn't a UUID can only be a mistake or an attack, so it is a 400;
 * an oversized `limit` is a reasonable thing to ask for and the services clamp
 * it, which is friendlier than an error.
 */

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("parseCursor", () => {
  it("passes a well-formed uuid through unchanged", () => {
    assert.equal(parseCursor(UUID), UUID);
  });

  it("treats absent and blank as 'no cursor', not as an error", () => {
    assert.equal(parseCursor(undefined), undefined);
    assert.equal(parseCursor(""), undefined);
    assert.equal(parseCursor("   "), undefined);
  });

  it("refuses anything that is not a uuid with a 400", () => {
    for (const bad of [
      "not-a-uuid",
      "1",
      // A near-miss: right shape, one character too few.
      "3f2504e0-4f89-41d3-9a0c-0305e82c330",
      // The failure that motivated this helper — a value that would have
      // reached Postgres and come back as a 500 cast error.
      "'; DROP TABLE trips;--",
    ]) {
      assert.throws(
        () => parseCursor(bad),
        BadRequestException,
        `expected ${bad} to be refused`,
      );
    }
  });
});

describe("requireIdParam", () => {
  it("returns the id when it is a uuid", () => {
    assert.equal(requireIdParam(UUID, "after"), UUID);
  });

  it("refuses a missing value — unlike a cursor, this one is required", () => {
    assert.throws(
      () => requireIdParam(undefined, "after"),
      BadRequestException,
    );
  });

  it("names the offending parameter in the message", () => {
    assert.throws(
      () => requireIdParam("nope", "after"),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /after/);
        return true;
      },
    );
  });
});

describe("parseLimit", () => {
  it("parses a number", () => {
    assert.equal(parseLimit("25"), 25);
  });

  it("is undefined when absent or unparseable, so the service default wins", () => {
    assert.equal(parseLimit(undefined), undefined);
    assert.equal(parseLimit("many"), undefined);
    assert.equal(parseLimit(""), undefined);
  });

  it("does NOT clamp — range is the service's call, not the boundary's", () => {
    // Deliberate: a caller asking for 10_000 gets clamped downstream rather than
    // refused, and a negative is likewise the service's to reject.
    assert.equal(parseLimit("10000"), 10_000);
    assert.equal(parseLimit("-5"), -5);
  });

  it("takes the leading integer of a mixed value, like parseInt", () => {
    // Documented rather than desired: `parseInt` stops at the first non-digit.
    // Callers clamp, so "20abc" behaving as 20 is harmless — but it should not
    // change silently.
    assert.equal(parseLimit("20abc"), 20);
  });
});
