import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAdminEmail } from "../src/admin/is-admin.js";
import { envSchema } from "../src/config/env.js";

/**
 * Who counts as an operator — the pure half.
 *
 * Worth testing directly rather than through the console's HTTP status, because
 * every failure mode here looks identical from the outside: a mis-parsed list
 * and a correctly-parsed list that excludes you both present as "the console
 * isn't there", which is also what a deployment with the feature switched off
 * looks like. Three indistinguishable states is exactly the shape of bug that
 * survives an e2e suite.
 */

/** The env schema needs the other required variables to parse at all. */
function parseWith(adminEmails: string | undefined): readonly string[] {
  const parsed = envSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    ...(adminEmails === undefined ? {} : { ADMIN_EMAILS: adminEmails }),
  });
  return parsed.ADMIN_EMAILS;
}

describe("ADMIN_EMAILS parsing", () => {
  it("is empty when unset, which is what keeps the console off by default", () => {
    assert.deepEqual(parseWith(undefined), []);
    // And an empty list can never match anyone, however the check is called.
    assert.equal(isAdminEmail("anyone@example.com", parseWith(undefined)), false);
  });

  it("splits on commas and survives the spaces a human leaves behind", () => {
    assert.deepEqual(parseWith("a@example.com, b@example.com ,c@example.com"), [
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("lowercases, so the case an address was typed in never decides access", () => {
    assert.deepEqual(parseWith("Zsolt@Example.COM"), ["zsolt@example.com"]);
  });

  it("drops empty entries from a trailing or doubled comma", () => {
    assert.deepEqual(parseWith("a@example.com,,b@example.com,"), [
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("isAdminEmail", () => {
  const allowed = ["zsolt@example.com"];

  it("matches regardless of the case the account was registered in", () => {
    assert.equal(isAdminEmail("ZSOLT@EXAMPLE.COM", allowed), true);
    assert.equal(isAdminEmail(" zsolt@example.com ", allowed), true);
  });

  it("does not match anybody else", () => {
    assert.equal(isAdminEmail("someone@example.com", allowed), false);
  });

  it("treats a missing address as not an operator", () => {
    // The guard reads `request.user?.email`, so undefined is reachable — and
    // the wrong answer here would open the console to a request with no user.
    assert.equal(isAdminEmail(undefined, allowed), false);
    assert.equal(isAdminEmail(null, allowed), false);
    assert.equal(isAdminEmail("", allowed), false);
  });

  it("is not fooled by a substring of a configured address", () => {
    assert.equal(isAdminEmail("zsolt@example.com.evil.test", allowed), false);
    assert.equal(isAdminEmail("xzsolt@example.com", allowed), false);
  });
});
