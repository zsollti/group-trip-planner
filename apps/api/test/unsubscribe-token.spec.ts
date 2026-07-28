import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/email/unsubscribe.token.js";

/**
 * One-click unsubscribe tokens (Phase 5.2, unit-tested in 7.4).
 *
 * The token is a stateless HMAC that arrives from an email client with no
 * session, so the signature *is* the authorization. The e2e suite proves the
 * route works for a valid token; what needs asserting here is everything that
 * must NOT work — a forged signature, a swapped payload, a token minted under a
 * different secret, and (the reason for the purpose tag) a token borrowed from
 * some other HMAC that shares `JWT_SECRET`.
 */

const SECRET = "unit-test-secret-0123456789abcdef";
const OTHER_SECRET = "a-completely-different-secret-value";
const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("unsubscribe token", () => {
  it("round-trips the user id", () => {
    const token = createUnsubscribeToken(USER, SECRET);
    assert.equal(verifyUnsubscribeToken(token, SECRET), USER);
  });

  it("is deterministic — the same user and secret mint the same token", () => {
    // Links live in already-delivered mail, so a token must keep verifying.
    assert.equal(
      createUnsubscribeToken(USER, SECRET),
      createUnsubscribeToken(USER, SECRET),
    );
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = createUnsubscribeToken(USER, OTHER_SECRET);
    assert.equal(verifyUnsubscribeToken(foreign, SECRET), null);
  });

  it("rejects a swapped payload — the id cannot be edited in the URL", () => {
    // The attack the signature exists to stop: keep a valid signature, point the
    // token at somebody else's account to silence their mail.
    const victim = "9c858901-8a57-4791-81fe-4c455b099bc9";
    const [, signature] = createUnsubscribeToken(USER, SECRET).split(".");
    const forged = `${Buffer.from(victim, "utf8").toString("base64url")}.${signature}`;
    assert.equal(verifyUnsubscribeToken(forged, SECRET), null);
  });

  it("rejects a tampered signature, including one of the right length", () => {
    const token = createUnsubscribeToken(USER, SECRET);
    const [id, signature] = token.split(".");
    // Same length, one character different — the length check must not be the
    // only thing doing the work.
    const flipped =
      signature!.slice(0, -1) + (signature!.endsWith("A") ? "B" : "A");
    assert.equal(verifyUnsubscribeToken(`${id}.${flipped}`, SECRET), null);
    assert.equal(verifyUnsubscribeToken(`${id}.short`, SECRET), null);
  });

  it("rejects malformed shapes rather than throwing", () => {
    // A verifier reached straight from a URL must be total: anything it cannot
    // read is a null, never a 500.
    for (const bad of ["", ".", "nodot", `${USER}.`, ".signature", "a.b.c"]) {
      assert.equal(
        verifyUnsubscribeToken(bad, SECRET),
        null,
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });

  it("is purpose-tagged, so another HMAC over the same secret does not verify", () => {
    // Domain separation: a bare HMAC of the user id — what a second feature
    // signing with JWT_SECRET would plausibly produce — must not unsubscribe.
    const untagged = createHmac("sha256", SECRET)
      .update(USER)
      .digest()
      .toString("base64url");
    const token = `${Buffer.from(USER, "utf8").toString("base64url")}.${untagged}`;
    assert.equal(verifyUnsubscribeToken(token, SECRET), null);
  });
});
