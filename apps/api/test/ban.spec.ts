import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BAN_REASON_MAX,
  BanUserInput,
  banEndDate,
  banIsActive,
  type BanFields,
} from "@gtp/types";
import { bannedException } from "../src/auth/ban.js";
import { localizedPattern } from "../src/i18n/localized-message.js";

/**
 * App-wide suspension, as a pure question (post-launch).
 *
 * Four call sites ask whether an account is banned — sign-in, the Google
 * callback, refresh rotation and the per-request guard — and they all ask the
 * one function tested here. That is what these cases are really about: the rule
 * is stated once, so it can be pinned once, and the expiry half cannot be
 * forgotten by one caller in four.
 */

const never: BanFields = { bannedAt: null, bannedUntil: null, banReason: null };
const permanent: BanFields = {
  bannedAt: new Date("2026-01-01T00:00:00.000Z"),
  bannedUntil: null,
  banReason: "Spamming every board they joined.",
};
const until = (iso: string): BanFields => ({
  bannedAt: new Date("2026-01-01T00:00:00.000Z"),
  bannedUntil: new Date(iso),
  banReason: "Cooling off.",
});

describe("banIsActive", () => {
  it("says no for an account that was never suspended", () => {
    assert.equal(banIsActive(never), false);
  });

  it("says yes, forever, when there is no end date", () => {
    assert.equal(
      banIsActive(permanent, new Date("2026-01-02T00:00:00Z")),
      true,
    );
    assert.equal(
      banIsActive(permanent, new Date("2099-01-01T00:00:00Z")),
      true,
    );
  });

  it("says yes right up to the end and no from the end onward", () => {
    const ban = until("2026-09-01T00:00:00.000Z");
    assert.equal(banIsActive(ban, new Date("2026-08-31T23:59:59Z")), true);
    // The boundary itself is *over*: the ban lifts at the start of the named
    // day, which is what makes "suspended until 1 September" true of August.
    assert.equal(banIsActive(ban, new Date("2026-09-01T00:00:00Z")), false);
    assert.equal(banIsActive(ban, new Date("2026-09-02T00:00:00Z")), false);
  });

  it("reads a row whose dates arrived as ISO strings", () => {
    // The contract carries them as strings and Prisma carries them as `Date`s,
    // and the console asks this about the first kind while the guard asks it
    // about the second. A helper that only understood one would fail on the
    // surface nobody thought to test.
    assert.equal(
      banIsActive(
        {
          bannedAt: "2026-01-01T00:00:00.000Z",
          bannedUntil: "2026-09-01T00:00:00.000Z",
          banReason: "x",
        },
        new Date("2026-08-01T00:00:00Z"),
      ),
      true,
    );
  });
});

describe("banEndDate", () => {
  it("is null for a permanent suspension", () => {
    assert.equal(banEndDate(permanent), null);
  });

  it("names the day that was chosen, not the day before it", () => {
    // The regression this guards: `bannedUntil` is midnight UTC, so any
    // formatter running west of Greenwich renders it as the previous date. The
    // stored instant means a calendar day and this is the reading that keeps it.
    assert.equal(banEndDate(until("2026-09-01T00:00:00.000Z")), "2026-09-01");
  });
});

describe("BanUserInput", () => {
  it("takes a calendar date or an explicit null for permanent", () => {
    assert.equal(
      BanUserInput.safeParse({ until: "2026-09-01", reason: "no" }).success,
      true,
    );
    assert.equal(
      BanUserInput.safeParse({ until: null, reason: "no" }).success,
      true,
    );
  });

  it("refuses an instant where a date belongs", () => {
    assert.equal(
      BanUserInput.safeParse({
        until: "2026-09-01T12:00:00Z",
        reason: "no",
      }).success,
      false,
    );
  });

  it("insists on a reason", () => {
    // The whole point of the feature: an account that stops working with no
    // stated cause is what this exists to prevent, so a blank reason — or one
    // that is only whitespace — is not a valid suspension.
    assert.equal(
      BanUserInput.safeParse({ until: null, reason: "" }).success,
      false,
    );
    assert.equal(
      BanUserInput.safeParse({ until: null, reason: "   " }).success,
      false,
    );
    assert.equal(
      BanUserInput.safeParse({
        until: null,
        reason: "x".repeat(BAN_REASON_MAX + 1),
      }).success,
      false,
    );
  });
});

describe("bannedException", () => {
  it("is a 403 — the password was right", () => {
    assert.equal(bannedException(permanent).getStatus(), 403);
  });

  it("says what happened and why, without an end date", () => {
    const message = bannedException(permanent).message;
    assert.match(message, /suspended/i);
    assert.match(message, /Spamming every board/);
    // No date to promise, so none is invented.
    assert.doesNotMatch(message, /\d{4}-\d{2}-\d{2}/);
  });

  it("names the end date when there is one", () => {
    const message = bannedException(until("2026-09-01T00:00:00.000Z")).message;
    assert.match(message, /2026-09-01/);
    assert.match(message, /Cooling off/);
  });

  it("carries its pattern, so the reader gets it in their own language", () => {
    // Without this the sentence reaches a Hungarian screen in English — the
    // exact failure the i18n pattern mechanism exists for, and one that is
    // invisible from the English side.
    const pattern = localizedPattern(bannedException(permanent));
    assert.ok(pattern);
    assert.match(pattern.pattern, /\{reason\}/);
    assert.equal(pattern.params.reason, permanent.banReason);
  });
});
