import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  canActOn,
  canAssignRole,
  canDeleteMessage,
  type TripAction,
  type TripRole,
} from "@gtp/types";

/**
 * The whole §3 permission matrix, transcribed independently from the source of
 * truth so the two must agree cell-for-cell. `true` = ✅ in the SRS table. This
 * is the Phase-1.2 DoD: "unit tests cover the whole permission matrix."
 */
const EXPECTED: Record<TripAction, Record<TripRole, boolean>> = {
  "trip.view": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: true,
  },
  // The only other row every role holds. A personal item is private to whoever
  // wrote it and touches nothing shared, so the reasons the rows below narrow
  // do not apply — there is nobody to disturb. A Guest weighing up whether to
  // join is exactly the person who wants to price their own flight first.
  "personalItem.manage": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: true,
  },
  // Chat is not a Guest surface (post-launch). `message.read` is its own row so
  // the rule is real rather than a hidden button: the message routes were
  // guarded by `trip.view`, and without this row a Guest could still have asked
  // the API for the whole transcript.
  "message.read": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: false,
  },
  "message.post": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: false,
  },
  "message.deleteOwn": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: false,
  },
  "message.deleteAny": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "vote.cast": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: false,
  },
  "option.propose": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: false,
  },
  "decision.lock": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "trip.edit": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "category.manage": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "invite.create": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "member.manage": {
    OWNER: true,
    CO_ORGANIZER: true,
    PARTICIPANT: false,
    GUEST: false,
  },
  "trip.transferOwnership": {
    OWNER: true,
    CO_ORGANIZER: false,
    PARTICIPANT: false,
    GUEST: false,
  },
  "trip.delete": {
    OWNER: true,
    CO_ORGANIZER: false,
    PARTICIPANT: false,
    GUEST: false,
  },
  // Owner cannot leave directly (must transfer/delete first, FR-12).
  "trip.leave": {
    OWNER: false,
    CO_ORGANIZER: true,
    PARTICIPANT: true,
    GUEST: true,
  },
};

const ROLES: TripRole[] = ["OWNER", "CO_ORGANIZER", "PARTICIPANT", "GUEST"];

describe("can() — the §3 permission matrix", () => {
  for (const action of Object.keys(EXPECTED) as TripAction[]) {
    for (const role of ROLES) {
      const expected = EXPECTED[action][role];
      it(`${role} ${expected ? "CAN" : "CANNOT"} ${action}`, () => {
        assert.equal(can(role, action), expected);
      });
    }
  }
});

describe("canActOn() — the strictly-lower-role rule", () => {
  it("Owner can act on every lower role", () => {
    assert.ok(canActOn("OWNER", "CO_ORGANIZER"));
    assert.ok(canActOn("OWNER", "PARTICIPANT"));
    assert.ok(canActOn("OWNER", "GUEST"));
  });

  it("Owner cannot act on another Owner (self/peer)", () => {
    assert.equal(canActOn("OWNER", "OWNER"), false);
  });

  it("Co-organizer can act only on strictly lower roles", () => {
    assert.ok(canActOn("CO_ORGANIZER", "PARTICIPANT"));
    assert.ok(canActOn("CO_ORGANIZER", "GUEST"));
  });

  it("Co-organizer cannot act on the Owner or a peer Co-organizer", () => {
    assert.equal(canActOn("CO_ORGANIZER", "OWNER"), false);
    assert.equal(canActOn("CO_ORGANIZER", "CO_ORGANIZER"), false);
  });

  it("Participants and Guests can never manage members", () => {
    for (const target of ROLES) {
      assert.equal(canActOn("PARTICIPANT", target), false);
      assert.equal(canActOn("GUEST", target), false);
    }
  });
});

describe("canAssignRole() — the strictly-lower rule for role changes", () => {
  it("Owner may assign any role below Owner, but never Owner", () => {
    assert.ok(canAssignRole("OWNER", "CO_ORGANIZER"));
    assert.ok(canAssignRole("OWNER", "PARTICIPANT"));
    assert.ok(canAssignRole("OWNER", "GUEST"));
    // OWNER is never assignable by a role change — ownership moves by transfer.
    assert.equal(canAssignRole("OWNER", "OWNER"), false);
  });

  it("Co-organizer may assign only strictly-lower roles (no peer promotion)", () => {
    assert.ok(canAssignRole("CO_ORGANIZER", "PARTICIPANT"));
    assert.ok(canAssignRole("CO_ORGANIZER", "GUEST"));
    assert.equal(canAssignRole("CO_ORGANIZER", "CO_ORGANIZER"), false);
    assert.equal(canAssignRole("CO_ORGANIZER", "OWNER"), false);
  });

  it("Participants and Guests can never assign any role", () => {
    for (const target of ROLES) {
      assert.equal(canAssignRole("PARTICIPANT", target), false);
      assert.equal(canAssignRole("GUEST", target), false);
    }
  });
});

/**
 * The last target-scoped rule without direct coverage (Phase 7.4). Its sibling
 * `canManageOption` is unit-tested in `options.spec.ts`; this one was only ever
 * exercised through the chat e2e suite, which cannot enumerate the matrix.
 */
describe("canDeleteMessage() — own message vs. anyone's", () => {
  it("every member with chat may delete their own message", () => {
    // "Guests included" until post-launch, when Guest lost chat outright. A
    // Guest has no message to own, so the answer here is false for a reason
    // upstream of authorship — which is exactly why it is asserted separately.
    for (const role of ROLES.filter((r) => r !== "GUEST")) {
      assert.ok(
        canDeleteMessage(role, true),
        `${role} must be able to delete their own message`,
      );
    }
    assert.equal(canDeleteMessage("GUEST", true), false);
  });

  it("only Organizers may delete someone else's", () => {
    assert.ok(canDeleteMessage("OWNER", false));
    assert.ok(canDeleteMessage("CO_ORGANIZER", false));
    assert.equal(canDeleteMessage("PARTICIPANT", false), false);
    assert.equal(canDeleteMessage("GUEST", false), false);
  });

  it("authorship is what saves a Participant, not their rank", () => {
    // The pair that matters: same role, opposite answers. If this ever collapses
    // into one answer the ownership half of the rule has been lost.
    assert.notEqual(
      canDeleteMessage("PARTICIPANT", true),
      canDeleteMessage("PARTICIPANT", false),
    );
  });
});
