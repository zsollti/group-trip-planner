import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMentions } from "@gtp/types";

/**
 * Pure @mention resolution (Phase 4.3). Server-authoritative: only real trip
 * members can be mentioned, matching is word-boundary-safe, and multi-word names
 * resolve correctly.
 */
describe("resolveMentions", () => {
  const members = [
    { userId: "u-ada", displayName: "Ada" },
    { userId: "u-adalovelace", displayName: "Ada Lovelace" },
    { userId: "u-ann", displayName: "Ann" },
    { userId: "u-anna", displayName: "Anna" },
  ];

  it("resolves a simple @mention to its member id", () => {
    assert.deepEqual(resolveMentions("hi @Ann!", members), ["u-ann"]);
  });

  it("does not match a shorter name inside a longer one", () => {
    // "@Anna" must resolve to Anna, never also to Ann.
    assert.deepEqual(resolveMentions("hey @Anna", members), ["u-anna"]);
  });

  it("resolves a multi-word display name", () => {
    const out = resolveMentions("cc @Ada Lovelace please", members);
    assert.ok(out.includes("u-adalovelace"));
    // "@Ada" as a prefix of "@Ada Lovelace" is a word-boundary non-match for Ada.
    assert.ok(!out.includes("u-ada"));
  });

  it("ignores @tokens that aren't members", () => {
    assert.deepEqual(resolveMentions("@Ghost @Nobody", members), []);
  });

  it("is case-insensitive and de-duplicates", () => {
    assert.deepEqual(resolveMentions("@ann @ANN @Ann", members), ["u-ann"]);
  });
});
