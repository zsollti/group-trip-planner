import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notificationRecipients } from "@gtp/types";

/**
 * The pure recipient rule (Phase 5.1, decision 2) — the part of notifications
 * that is easy to get subtly wrong (self-notification, ex-members) and needs no
 * database to pin down.
 */
describe("notificationRecipients", () => {
  const members = [
    { userId: "owner" },
    { userId: "alice" },
    { userId: "bob" },
  ];

  it("fans a proposed option out to every member except the actor", () => {
    const got = notificationRecipients({
      type: "OPTION_PROPOSED",
      actorId: "alice",
      members,
    });
    assert.deepEqual(got.sort(), ["bob", "owner"]);
  });

  it("fans a lock out to every member except the actor", () => {
    const got = notificationRecipients({
      type: "OPTION_LOCKED",
      actorId: "owner",
      members,
    });
    assert.deepEqual(got.sort(), ["alice", "bob"]);
  });

  it("notifies only the mentioned users on a mention", () => {
    const got = notificationRecipients({
      type: "MENTION",
      actorId: "alice",
      members,
      mentionedUserIds: ["bob"],
    });
    assert.deepEqual(got, ["bob"]);
  });

  it("never notifies the actor, even when they mention themselves", () => {
    const got = notificationRecipients({
      type: "MENTION",
      actorId: "alice",
      members,
      mentionedUserIds: ["alice", "bob"],
    });
    assert.deepEqual(got, ["bob"]);
  });

  it("drops a mention of someone who is no longer a member", () => {
    const got = notificationRecipients({
      type: "MENTION",
      actorId: "alice",
      members,
      mentionedUserIds: ["bob", "ex-member"],
    });
    assert.deepEqual(got, ["bob"]);
  });

  it("de-duplicates repeated recipients", () => {
    const got = notificationRecipients({
      type: "MENTION",
      actorId: "owner",
      members,
      mentionedUserIds: ["bob", "bob", "alice"],
    });
    assert.deepEqual(got.sort(), ["alice", "bob"]);
  });

  it("returns nobody for a solo trip's own action", () => {
    const got = notificationRecipients({
      type: "OPTION_PROPOSED",
      actorId: "owner",
      members: [{ userId: "owner" }],
    });
    assert.deepEqual(got, []);
  });
});
