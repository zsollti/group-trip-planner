import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emailDedupeKey,
  MAX_EMAIL_ATTEMPTS,
  nextRetryDelayMs,
  shouldSendMentionEmail,
  type MentionEmailCandidate,
} from "@gtp/types";

/**
 * The pure rules behind the async email queue (Phase 5.2). These are the parts
 * that decide whether someone gets unwanted mail, gets the same mail twice, or
 * gets hammered by a retry loop — all decidable without a database or a clock.
 */

describe("shouldSendMentionEmail", () => {
  const opted: MentionEmailCandidate = {
    userId: "alice",
    emailOnMention: true,
    tripMuted: false,
    emailVerified: true,
    hasAddress: true,
  };

  it("sends to an opted-in member of an unmuted trip", () => {
    assert.equal(shouldSendMentionEmail(opted), true);
  });

  it("does not send when the global toggle is off", () => {
    assert.equal(
      shouldSendMentionEmail({ ...opted, emailOnMention: false }),
      false,
    );
  });

  it("does not send when the recipient muted this trip", () => {
    assert.equal(shouldSendMentionEmail({ ...opted, tripMuted: true }), false);
  });

  it("never mails an unverified address", () => {
    // Otherwise @mentioning a user would aim mail at an address nobody has
    // proven they own.
    assert.equal(
      shouldSendMentionEmail({ ...opted, emailVerified: false }),
      false,
    );
  });

  it("does not send to an anonymized account with no address", () => {
    assert.equal(
      shouldSendMentionEmail({ ...opted, hasAddress: false }),
      false,
    );
  });

  it("requires every condition, not just one", () => {
    assert.equal(
      shouldSendMentionEmail({
        ...opted,
        emailOnMention: true,
        tripMuted: true,
      }),
      false,
    );
  });
});

describe("emailDedupeKey", () => {
  it("is stable for the same event and recipient", () => {
    const key = () =>
      emailDedupeKey({
        type: "MENTION",
        eventId: "msg-1",
        recipientId: "alice",
      });
    assert.equal(key(), key());
  });

  it("separates recipients of the same event", () => {
    assert.notEqual(
      emailDedupeKey({
        type: "MENTION",
        eventId: "msg-1",
        recipientId: "alice",
      }),
      emailDedupeKey({ type: "MENTION", eventId: "msg-1", recipientId: "bob" }),
    );
  });

  it("separates events for the same recipient", () => {
    assert.notEqual(
      emailDedupeKey({
        type: "MENTION",
        eventId: "msg-1",
        recipientId: "alice",
      }),
      emailDedupeKey({
        type: "MENTION",
        eventId: "msg-2",
        recipientId: "alice",
      }),
    );
  });
});

describe("nextRetryDelayMs", () => {
  it("starts at one minute and doubles", () => {
    assert.equal(nextRetryDelayMs(1), 60_000);
    assert.equal(nextRetryDelayMs(2), 120_000);
    assert.equal(nextRetryDelayMs(3), 240_000);
  });

  it("keeps the whole retry budget inside the hour cap", () => {
    // The last scheduled retry is still well under the cap, so a job's five
    // attempts play out over ~30 minutes rather than being flattened by it.
    assert.equal(nextRetryDelayMs(MAX_EMAIL_ATTEMPTS), 16 * 60_000);
  });

  it("never exceeds an hour, however many attempts", () => {
    // A provider outage must not push a job weeks into the future.
    assert.equal(nextRetryDelayMs(7), 60 * 60_000);
    assert.equal(nextRetryDelayMs(50), 60 * 60_000);
  });

  it("is monotonic up to the cap", () => {
    for (let n = 1; n < 12; n += 1) {
      assert.ok(nextRetryDelayMs(n) <= nextRetryDelayMs(n + 1));
    }
  });

  it("treats a zero/negative attempt as the first retry", () => {
    assert.equal(nextRetryDelayMs(0), 60_000);
    assert.equal(nextRetryDelayMs(-3), 60_000);
  });
});
