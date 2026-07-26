import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activityHeadline, type ActivityEvent } from "@gtp/types";

/**
 * The pure feed wording (Phase 5.4). Worth pinning down without a database
 * because it is where a log row becomes a sentence a person reads — and where
 * missing snapshot fields would otherwise leave holes in that sentence.
 */

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    action: "OPTION_LOCKED",
    actorName: "Ada",
    targetName: null,
    subject: "Night train",
    fromRole: null,
    toRole: null,
    superseded: false,
    createdAt: "2026-07-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("activityHeadline", () => {
  it("describes a lock by its option title", () => {
    assert.equal(activityHeadline(event()), "Ada locked in “Night train”");
  });

  it("says a lock replaced the earlier pick when it superseded one", () => {
    // Otherwise a single-choice re-lock shows an unexplained unlock beside it.
    assert.equal(
      activityHeadline(event({ superseded: true })),
      "Ada locked in “Night train”, replacing the earlier pick",
    );
  });

  it("describes an unlock as reopening", () => {
    assert.equal(
      activityHeadline(event({ action: "OPTION_UNLOCKED" })),
      "Ada reopened “Night train”",
    );
  });

  it("names both roles on a role change", () => {
    assert.equal(
      activityHeadline(
        event({
          action: "MEMBER_ROLE_CHANGED",
          subject: null,
          targetName: "Grace",
          fromRole: "GUEST",
          toRole: "PARTICIPANT",
        }),
      ),
      "Ada changed Grace from Guest to Participant",
    );
  });

  it("falls back to a vaguer sentence when the roles are missing", () => {
    assert.equal(
      activityHeadline(
        event({
          action: "MEMBER_ROLE_CHANGED",
          subject: null,
          targetName: "Grace",
        }),
      ),
      "Ada changed Grace's role",
    );
  });

  it("describes the membership actions", () => {
    const member = { subject: null, targetName: "Grace" } as const;
    assert.equal(
      activityHeadline(event({ action: "MEMBER_KICKED", ...member })),
      "Ada removed Grace",
    );
    assert.equal(
      activityHeadline(event({ action: "MEMBER_BLOCKED", ...member })),
      "Ada blocked Grace",
    );
    assert.equal(
      activityHeadline(event({ action: "MEMBER_UNBLOCKED", ...member })),
      "Ada unblocked Grace",
    );
    assert.equal(
      activityHeadline(event({ action: "OWNERSHIP_TRANSFERRED", ...member })),
      "Ada handed ownership to Grace",
    );
  });

  it("reports a departure in the leaver's own name", () => {
    // Actor and target are the same person, so the line must not read
    // "Ada removed Ada".
    assert.equal(
      activityHeadline(
        event({
          action: "MEMBER_LEFT",
          subject: null,
          actorName: "Ada",
          targetName: "Ada",
        }),
      ),
      "Ada left the trip",
    );
  });

  it("degrades gracefully when a name is gone (anonymized actor)", () => {
    // The event is still true after the account is erased — the line must not
    // render with a hole in it.
    assert.equal(
      activityHeadline(event({ actorName: null })),
      "Someone locked in “Night train”",
    );
    assert.equal(
      activityHeadline(
        event({ action: "MEMBER_KICKED", subject: null, targetName: null }),
      ),
      "Ada removed a member",
    );
  });

  it("names an option event even without its title snapshot", () => {
    assert.equal(
      activityHeadline(event({ subject: null })),
      "Ada locked in “an option”",
    );
  });
});
