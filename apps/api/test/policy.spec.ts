import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CATEGORIES,
  DEFAULT_MAX_CATEGORY_OPTIONS,
  DEFAULT_MAX_TRIP_CATEGORIES,
  DEFAULT_MAX_TRIP_MEMBERS,
  maxCategoryOptions,
  maxTripCategories,
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

  it("caps categories at eight — what one lane row can hold", () => {
    assert.equal(maxTripCategories(), DEFAULT_MAX_TRIP_CATEGORIES);
    assert.equal(maxTripCategories(), 8);
    assert.equal(maxTripCategories({}), 8);
    // Deliberately NOT `BUILTIN_CATEGORIES.length + n`: the cap is a layout
    // budget for the row, so retiring a built-in buys a custom lane rather
    // than shrinking the board.
    assert.ok(maxTripCategories() > BUILTIN_CATEGORIES.length);
  });

  it("honours a per-trip category override (the same subscription seam)", () => {
    assert.equal(maxTripCategories({ maxCategoriesOverride: 20 }), 20);
    assert.equal(maxTripCategories({ maxCategoriesOverride: null }), 8);
  });

  it("caps a category's options at eight, independently of the lane cap", () => {
    assert.equal(maxCategoryOptions(), DEFAULT_MAX_CATEGORY_OPTIONS);
    assert.equal(maxCategoryOptions(), 8);
    assert.equal(maxCategoryOptions({}), 8);
  });

  it("honours a per-trip options override — the tier seam this exists for", () => {
    assert.equal(maxCategoryOptions({ maxCategoryOptionsOverride: 25 }), 25);
    assert.equal(maxCategoryOptions({ maxCategoryOptionsOverride: null }), 8);
  });

  it("keeps the three caps independent of one another", () => {
    // They happen to share a number today. Overriding one must not move the
    // others — that is the whole point of asking the policy per limit rather
    // than reading a shared constant.
    const trip = { maxCategoryOptionsOverride: 40 };
    assert.equal(maxCategoryOptions(trip), 40);
    assert.equal(maxTripCategories(trip), 8);
    assert.equal(maxTripMembers(trip), 30);
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
