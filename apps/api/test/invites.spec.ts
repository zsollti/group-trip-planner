import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveJoin, type TripRole } from "@gtp/types";

/**
 * Unit coverage for the pure join-resolution rule (SRS FR-16): idempotent,
 * upgrade-only, never a downgrade. The e2e suite exercises the same rule through
 * real HTTP + DB; this pins the logic in isolation.
 */
describe("resolveJoin() — idempotent / upgrade-never-downgrade", () => {
  it("a non-member JOINs at the link's role", () => {
    assert.deepEqual(resolveJoin(null, "PARTICIPANT"), {
      action: "JOIN",
      resultRole: "PARTICIPANT",
    });
    assert.deepEqual(resolveJoin(null, "GUEST"), {
      action: "JOIN",
      resultRole: "GUEST",
    });
  });

  it("a higher-role link UPGRADEs an existing member", () => {
    assert.deepEqual(resolveJoin("GUEST", "PARTICIPANT"), {
      action: "UPGRADE",
      resultRole: "PARTICIPANT",
    });
    assert.deepEqual(resolveJoin("PARTICIPANT", "CO_ORGANIZER"), {
      action: "UPGRADE",
      resultRole: "CO_ORGANIZER",
    });
  });

  it("an equal-role link is a NOOP (keeps the current role)", () => {
    assert.deepEqual(resolveJoin("PARTICIPANT", "PARTICIPANT"), {
      action: "NOOP",
      resultRole: "PARTICIPANT",
    });
  });

  it("a lower-role link never downgrades — NOOP at the higher role", () => {
    assert.deepEqual(resolveJoin("CO_ORGANIZER", "PARTICIPANT"), {
      action: "NOOP",
      resultRole: "CO_ORGANIZER",
    });
    assert.deepEqual(resolveJoin("PARTICIPANT", "GUEST"), {
      action: "NOOP",
      resultRole: "PARTICIPANT",
    });
  });

  it("never yields a role below the caller's current one, for any combination", () => {
    const RANK: Record<TripRole, number> = {
      OWNER: 3,
      CO_ORGANIZER: 2,
      PARTICIPANT: 1,
      GUEST: 0,
    };
    const roles: TripRole[] = ["GUEST", "PARTICIPANT", "CO_ORGANIZER", "OWNER"];
    for (const current of roles) {
      for (const link of roles) {
        const { resultRole } = resolveJoin(current, link);
        assert.ok(
          RANK[resultRole] >= RANK[current],
          `${current} + ${link} must not downgrade (got ${resultRole})`,
        );
      }
    }
  });
});
