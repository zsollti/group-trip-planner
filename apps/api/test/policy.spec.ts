import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_TRIP_MEMBERS,
  maxTripMembers,
  maxTripHorizonDays,
  pickSuccessor,
  type SuccessorCandidate,
} from "@gtp/types";

/**
 * The policy layer (SRS FR-11) and the ownership-successor cascade (FR-6) as
 * pure functions. The member cap must come from here — never a literal — so the
 * join handler asks the policy what "full" means; the cascade is exercised in
 * isolation here and reused by Phase 1.5's account-deletion transfer.
 */
describe("policy.maxTripMembers / maxTripHorizonDays", () => {
  it("defaults to 30 members with no override", () => {
    assert.equal(maxTripMembers(), DEFAULT_MAX_TRIP_MEMBERS);
    assert.equal(maxTripMembers(), 30);
    assert.equal(maxTripMembers({}), 30);
  });

  it("honours a per-trip override (the post-MVP subscription seam)", () => {
    assert.equal(maxTripMembers({ maxMembersOverride: 100 }), 100);
    // A null override is "no override" → the default.
    assert.equal(maxTripMembers({ maxMembersOverride: null }), 30);
  });

  it("exposes a (stubbed) horizon default for Phase 2", () => {
    assert.equal(maxTripHorizonDays(), 365);
    assert.equal(maxTripHorizonDays({ maxHorizonDaysOverride: 90 }), 90);
  });
});

describe("policy.pickSuccessor — ownership cascade", () => {
  const at = (iso: string) => new Date(iso);

  it("prefers the longest-tenured Co-organizer over any Participant", () => {
    const members: SuccessorCandidate[] = [
      { userId: "p-early", role: "PARTICIPANT", joinedAt: at("2026-01-01") },
      { userId: "c-late", role: "CO_ORGANIZER", joinedAt: at("2026-03-01") },
      { userId: "c-early", role: "CO_ORGANIZER", joinedAt: at("2026-02-01") },
    ];
    assert.equal(pickSuccessor(members)?.userId, "c-early");
  });

  it("falls back to the longest-tenured Participant when no Co-organizer", () => {
    const members: SuccessorCandidate[] = [
      { userId: "p-late", role: "PARTICIPANT", joinedAt: at("2026-05-01") },
      { userId: "p-early", role: "PARTICIPANT", joinedAt: at("2026-01-01") },
      { userId: "g", role: "GUEST", joinedAt: at("2025-01-01") },
    ];
    assert.equal(pickSuccessor(members)?.userId, "p-early");
  });

  it("never promotes a Guest — returns null for a Guest-only remainder", () => {
    const members: SuccessorCandidate[] = [
      { userId: "g1", role: "GUEST", joinedAt: at("2026-01-01") },
      { userId: "g2", role: "GUEST", joinedAt: at("2026-02-01") },
    ];
    assert.equal(pickSuccessor(members), null);
  });

  it("returns null for a solo trip (no other members)", () => {
    assert.equal(pickSuccessor([]), null);
  });
});
