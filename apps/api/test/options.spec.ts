import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canManageOption,
  hasMaterialChange,
  type OptionMaterialSnapshot,
} from "@gtp/types";

/**
 * Pure option rules (no DB): the proposer-or-Organizer edit rule and the
 * material-change predicate that flags votes stale (FR-23).
 */
describe("canManageOption", () => {
  it("lets the proposer manage their own option (Participant+)", () => {
    assert.equal(canManageOption("PARTICIPANT", true), true);
    assert.equal(canManageOption("CO_ORGANIZER", true), true);
    assert.equal(canManageOption("OWNER", true), true);
  });

  it("lets an Organizer manage anyone's option", () => {
    assert.equal(canManageOption("OWNER", false), true);
    assert.equal(canManageOption("CO_ORGANIZER", false), true);
  });

  it("blocks a Participant from managing someone else's option", () => {
    assert.equal(canManageOption("PARTICIPANT", false), false);
  });

  it("blocks a Guest entirely — even for an option they somehow proposed", () => {
    // A Guest lacks option.propose, so proposer-scope doesn't apply and they are
    // not an Organizer either.
    assert.equal(canManageOption("GUEST", true), false);
    assert.equal(canManageOption("GUEST", false), false);
  });
});

describe("hasMaterialChange", () => {
  const base: OptionMaterialSnapshot = {
    amount: 100,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    startsAt: null,
    endsAt: null,
  };

  it("is false when nothing material changed", () => {
    assert.equal(hasMaterialChange(base, { ...base }), false);
  });

  it("flags a cost-affecting change", () => {
    assert.equal(hasMaterialChange(base, { ...base, amount: 120 }), true);
    assert.equal(hasMaterialChange(base, { ...base, currency: "HUF" }), true);
    assert.equal(hasMaterialChange(base, { ...base, costType: "TOTAL" }), true);
    assert.equal(hasMaterialChange(base, { ...base, headcount: 4 }), true);
    assert.equal(
      hasMaterialChange(base, { ...base, headcountIsFixed: true }),
      true,
    );
  });

  it("flags a date change", () => {
    assert.equal(
      hasMaterialChange(base, {
        ...base,
        startsAt: "2026-08-01T10:00:00.000Z",
      }),
      true,
    );
  });
});
