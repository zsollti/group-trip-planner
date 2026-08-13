import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatApproxMoney,
  formatMoney,
  parseAmount,
  regroupAmountInput,
} from "./money";

/**
 * The test environment runs under the machine's locale (Hungarian on the
 * author's box, en-US in CI), so **nothing here asserts a literal separator** —
 * the same rule the timeline tests follow for dates. What is asserted is the
 * property that matters: long numbers get grouped, and whatever this module
 * formats, it can read back.
 */

describe("formatAmount", () => {
  it("groups a long number", () => {
    const formatted = formatAmount(45000);
    expect(formatted).not.toBe("45000");
    // Whichever separator the locale uses, the digits are unchanged.
    expect(formatted.replace(/\D/g, "")).toBe("45000");
  });

  it("leaves a short number alone", () => {
    expect(formatAmount(620)).toBe("620");
  });

  it("shows cents only when there are any", () => {
    expect(formatAmount(620)).toBe("620");
    expect(formatAmount(37.5).replace(/\D/g, "")).toBe("375");
  });
});

describe("formatApproxMoney", () => {
  it("marks the figure as approximate and drops the cents", () => {
    const formatted = formatApproxMoney(1239.87, "EUR");
    expect(formatted.startsWith("≈")).toBe(true);
    expect(formatted.replace(/\D/g, "")).toBe("1240");
  });

  it("is the locale's own currency formatting, not a bare number", () => {
    // Asserted against `Intl` rather than a literal, because how a currency is
    // written is the locale's business: en-US gives "€1,240" and hu-HU gives
    // "1240 EUR", and both are right. A literal expectation here would pass on
    // one machine and fail on CI — the mistake this file's header exists to
    // prevent, and one this suite has actually shipped before.
    const reference = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(1240);
    expect(formatApproxMoney(1240, "EUR")).toBe(`≈ ${reference}`);
  });

  it("falls back to the bare code for a currency Intl does not know", () => {
    const formatted = formatApproxMoney(1200, "ZZZ");
    expect(formatted).toContain("ZZZ");
    expect(formatted.replace(/\D/g, "")).toBe("1200");
  });
});

describe("formatMoney", () => {
  it("groups and marks the currency", () => {
    const formatted = formatMoney(45000, "EUR");
    expect(formatted).toMatch(/45\D?000/);
    expect(formatted).not.toBe("45000 EUR");
  });

  it("falls back to the bare code for a currency Intl does not know", () => {
    // `currencySchema` accepts any three letters (FR-27), so this has to be
    // total or a made-up code throws inside a render.
    const formatted = formatMoney(1200, "ZZZ");
    expect(formatted).toContain("ZZZ");
    expect(formatted.replace(/\D/g, "")).toBe("1200");
  });
});

describe("parseAmount", () => {
  it("reads back anything this module formatted", () => {
    for (const n of [0, 7, 620, 45000, 1234567, 37.5, 0.99]) {
      expect(parseAmount(formatAmount(n))).toBe(n);
    }
  });

  it("accepts plain digits as typed", () => {
    expect(parseAmount("45000")).toBe(45000);
    expect(parseAmount("  620 ")).toBe(620);
  });

  it("reads a decimal written the way this locale writes one", () => {
    // Asked of `Intl` rather than hard-coded, for the same reason the module
    // asks: this suite runs under the machine's locale.
    //
    // The first version of this test claimed a decimal comma works "whatever
    // the locale", and CI — which runs en-US — proved that impossible. There
    // the comma is the *group* separator, so `12,50` is already `1250` before
    // any comma-means-decimal rule could fire. Accepting an amount as a
    // different amount is worse than refusing it.
    const decimal =
      new Intl.NumberFormat()
        .formatToParts(1.5)
        .find((p) => p.type === "decimal")?.value ?? ".";
    expect(parseAmount(`12${decimal}50`)).toBe(12.5);
  });

  it("refuses what is not a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
    expect(parseAmount(".")).toBeNull();
  });
});

describe("regroupAmountInput", () => {
  it("groups what a person typed", () => {
    expect(regroupAmountInput("45000").replace(/\D/g, "")).toBe("45000");
    expect(regroupAmountInput("45000")).not.toBe("45000");
  });

  it("is idempotent, so blurring twice cannot compound separators", () => {
    const once = regroupAmountInput("1234567");
    expect(regroupAmountInput(once)).toBe(once);
  });

  it("hands back anything it cannot read, rather than blanking the field", () => {
    // Losing what someone typed is worse than showing it ungrouped.
    expect(regroupAmountInput("not a number")).toBe("not a number");
    expect(regroupAmountInput("")).toBe("");
  });
});
