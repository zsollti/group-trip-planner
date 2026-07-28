import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../src/config/env.js";

/**
 * The production-only half of the environment contract (Phase 7.5).
 *
 * These three checks exist because their development defaults are convenient
 * and their production values are load-bearing, so a mistake ships green: the
 * whole test suite runs with NODE_ENV=test and never evaluates them. That is
 * also why they are worth testing directly — a deploy is the only other thing
 * that exercises this code, and it exercises it exactly once, in the place
 * where finding out costs the most.
 *
 * Each case asserts the issue's `path`, not just that parsing failed: a
 * fixture missing some other required field would otherwise make a "should be
 * rejected" test pass for entirely the wrong reason.
 */

/** A minimal, valid production environment; each test spoils one field. */
function productionEnv(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://gtp:pw@db.internal:5432/gtp",
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    CORS_ORIGINS: "https://board.example.com",
    UPLOAD_DIR: "/data/uploads",
    ...overrides,
  };
}

/** The single message from a failed load, or "" when it unexpectedly passed. */
function failureFor(source: NodeJS.ProcessEnv): string {
  try {
    loadEnv(source);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("loadEnv in production", () => {
  it("accepts a well-formed production environment", () => {
    const env = loadEnv(productionEnv());
    assert.equal(env.UPLOAD_DIR, "/data/uploads");
    assert.deepEqual(env.CORS_ORIGINS, ["https://board.example.com"]);
  });

  it("rejects a relative UPLOAD_DIR, which a redeploy would discard", () => {
    const message = failureFor(productionEnv({ UPLOAD_DIR: "./var/uploads" }));
    assert.match(message, /UPLOAD_DIR/);
    assert.match(message, /absolute path/);
  });

  it("accepts an absolute Windows UPLOAD_DIR", () => {
    const env = loadEnv(productionEnv({ UPLOAD_DIR: "D:\\gtp\\uploads" }));
    assert.equal(env.UPLOAD_DIR, "D:\\gtp\\uploads");
  });

  it("rejects the localhost CORS default reaching production", () => {
    const message = failureFor(
      productionEnv({ CORS_ORIGINS: "http://localhost:5175" }),
    );
    assert.match(message, /CORS_ORIGINS/);
    assert.match(message, /https:\/\//);
  });

  it("rejects a single http origin hidden among https ones", () => {
    const message = failureFor(
      productionEnv({
        CORS_ORIGINS: "https://board.example.com,http://staging.example.com",
      }),
    );
    assert.match(message, /CORS_ORIGINS/);
    assert.match(message, /http:\/\/staging\.example\.com/);
  });

  it("rejects the .env.example placeholder secret", () => {
    const message = failureFor(
      productionEnv({ JWT_SECRET: "change-me-to-a-long-random-secret" }),
    );
    assert.match(message, /JWT_SECRET/);
    assert.match(message, /placeholder/);
  });

  it("reports every production problem at once, not just the first", () => {
    const message = failureFor(
      productionEnv({
        UPLOAD_DIR: "./var/uploads",
        CORS_ORIGINS: "http://localhost:5175",
        JWT_SECRET: "change-me-to-a-long-random-secret",
      }),
    );
    assert.match(message, /UPLOAD_DIR/);
    assert.match(message, /CORS_ORIGINS/);
    assert.match(message, /JWT_SECRET/);
  });
});

describe("loadEnv outside production", () => {
  it("leaves the development defaults alone", () => {
    // The same values that fail above are the documented dev defaults; the
    // checks must not leak out of production and break local work or CI.
    const env = loadEnv({
      DATABASE_URL: "postgresql://gtp:gtp_dev_password@localhost:5432/gtp_dev",
      JWT_SECRET: "change-me-to-a-long-random-secret",
    });
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.UPLOAD_DIR, "./var/uploads");
    assert.deepEqual(env.CORS_ORIGINS, [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ]);
  });
});
