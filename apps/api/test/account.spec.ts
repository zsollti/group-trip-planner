import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAccountDeletion,
  type OwnedTripForDeletion,
} from "@gtp/types";

/**
 * The account-deletion planner (SRS FR-6) as a pure function: for each owned trip
 * it decides transfer-to-successor vs delete-if-solo, reusing the same successor
 * cascade the explicit Phase-1.4 transfer uses. The DB orchestration around it is
 * covered by the integration test; here we pin the branching in isolation.
 */
describe("planAccountDeletion — owned-trip disposition", () => {
  const at = (iso: string) => new Date(iso);

  it("transfers to the longest-tenured Co-organizer over any Participant", () => {
    const owned: OwnedTripForDeletion[] = [
      {
        tripId: "11111111-1111-1111-1111-111111111111",
        tripName: "Lisbon",
        otherMembers: [
          {
            userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            role: "PARTICIPANT",
            joinedAt: at("2026-01-01"),
            displayName: "Early Participant",
          },
          {
            userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            role: "CO_ORGANIZER",
            joinedAt: at("2026-03-01"),
            displayName: "Late Coorg",
          },
          {
            userId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            role: "CO_ORGANIZER",
            joinedAt: at("2026-02-01"),
            displayName: "Early Coorg",
          },
        ],
      },
    ];

    const plan = planAccountDeletion(owned);
    assert.equal(plan.deletions.length, 0);
    assert.equal(plan.transfers.length, 1);
    const [transfer] = plan.transfers;
    assert.ok(transfer);
    assert.equal(
      transfer.successorUserId,
      "cccccccc-cccc-cccc-cccc-cccccccccccc",
    );
    assert.equal(transfer.successorDisplayName, "Early Coorg");
    assert.equal(transfer.tripName, "Lisbon");
  });

  it("falls back to the longest-tenured Participant when no Co-organizer", () => {
    const owned: OwnedTripForDeletion[] = [
      {
        tripId: "22222222-2222-2222-2222-222222222222",
        tripName: "Porto",
        otherMembers: [
          {
            userId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            role: "PARTICIPANT",
            joinedAt: at("2026-05-01"),
            displayName: "Late",
          },
          {
            userId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            role: "PARTICIPANT",
            joinedAt: at("2026-01-01"),
            displayName: "Early",
          },
          {
            userId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
            role: "GUEST",
            joinedAt: at("2025-01-01"),
            displayName: "Ancient Guest",
          },
        ],
      },
    ];

    const plan = planAccountDeletion(owned);
    assert.equal(plan.transfers.length, 1);
    const [transfer] = plan.transfers;
    assert.ok(transfer);
    assert.equal(
      transfer.successorUserId,
      "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    );
  });

  it("deletes a solo or Guest-only trip (no eligible successor)", () => {
    const owned: OwnedTripForDeletion[] = [
      {
        tripId: "33333333-3333-3333-3333-333333333333",
        tripName: "Solo",
        otherMembers: [],
      },
      {
        tripId: "44444444-4444-4444-4444-444444444444",
        tripName: "Guests Only",
        otherMembers: [
          {
            userId: "99999999-9999-9999-9999-999999999999",
            role: "GUEST",
            joinedAt: at("2026-01-01"),
            displayName: "A Guest",
          },
        ],
      },
    ];

    const plan = planAccountDeletion(owned);
    assert.equal(plan.transfers.length, 0);
    assert.deepEqual(
      plan.deletions.map((d) => d.tripName).sort(),
      ["Guests Only", "Solo"],
    );
  });

  it("handles a mix across several owned trips, and no trips at all", () => {
    assert.deepEqual(planAccountDeletion([]), {
      transfers: [],
      deletions: [],
    });

    const owned: OwnedTripForDeletion[] = [
      {
        tripId: "55555555-5555-5555-5555-555555555555",
        tripName: "Has Heir",
        otherMembers: [
          {
            userId: "12121212-1212-1212-1212-121212121212",
            role: "CO_ORGANIZER",
            joinedAt: at("2026-02-01"),
            displayName: "Heir",
          },
        ],
      },
      {
        tripId: "66666666-6666-6666-6666-666666666666",
        tripName: "No Heir",
        otherMembers: [],
      },
    ];
    const plan = planAccountDeletion(owned);
    assert.equal(plan.transfers.length, 1);
    assert.equal(plan.transfers[0]?.tripName, "Has Heir");
    assert.equal(plan.deletions.length, 1);
    assert.equal(plan.deletions[0]?.tripName, "No Heir");
  });
});
