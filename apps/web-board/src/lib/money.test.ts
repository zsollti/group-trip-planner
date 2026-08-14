import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatApproxMoney,
  formatMoney,
  parseAmount,
  regroupAmountInput,
  regroupWhileTyping,
  type AmountFieldState,
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

  it("groups from four digits, whatever the locale would rather do", () => {
    // `Intl`'s default defers to the locale's `minimumGroupingDigits`, and much
    // of Europe — Hungarian included, which is this box's locale — sets it to
    // two, so a bare `5000` comes back. In a column of prices that is the
    // number most likely to be misread, and it would leave the amount field
    // appearing to ungroup a figure the moment you left it.
    expect(formatAmount(5000)).not.toBe("5000");
    expect(formatAmount(5000).replace(/\D/g, "")).toBe("5000");
    expect(formatMoney(5000, "EUR").replace(/\D/g, "")).toBe("5000");
    expect(formatMoney(5000, "EUR")).not.toContain("5000");
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
    // prevent, and one this suite has actually shipped before. The one thing
    // the reference does *not* borrow from the locale is when to start
    // grouping — this module overrides that deliberately (see `GROUPING`), so
    // the reference has to state the same override or it is testing `Intl`'s
    // preference rather than this module's.
    const reference = new Intl.NumberFormat(undefined, {
      useGrouping: "always",
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

describe("regroupWhileTyping", () => {
  /** The reader's decimal point, asked of `Intl` — never assumed to be ".". */
  const decimal =
    new Intl.NumberFormat(undefined)
      .formatToParts(1.5)
      .find((p) => p.type === "decimal")?.value ?? ".";

  const EMPTY: AmountFieldState = { value: "", caret: 0 };

  /** One keystroke: insert at the caret, then let the field regroup itself. */
  function press(state: AmountFieldState, char: string): AmountFieldState {
    const raw =
      state.value.slice(0, state.caret) + char + state.value.slice(state.caret);
    return regroupWhileTyping(raw, state.caret + char.length);
  }

  /** Backspace: drop the character before the caret, then regroup. */
  function backspace(state: AmountFieldState): AmountFieldState {
    const raw =
      state.value.slice(0, state.caret - 1) + state.value.slice(state.caret);
    return regroupWhileTyping(raw, state.caret - 1);
  }

  const type = (keys: string) => [...keys].reduce(press, EMPTY);
  const digits = (s: string) => s.replace(/\D/g, "");
  /** Where the caret really is: how many digits sit to its left. */
  const digitsBeforeCaret = (s: AmountFieldState) =>
    digits(s.value.slice(0, s.caret)).length;

  it("groups on the keystroke that makes the number long enough", () => {
    // The ask: 500 stays 500, and the fourth digit turns it into 5 000 there
    // and then — not on blur.
    expect(type("500").value).toBe("500");
    const fourth = type("5000");
    expect(fourth.value).not.toBe("5000");
    expect(digits(fourth.value)).toBe("5000");
  });

  it("leaves the caret after the digit that was just typed", () => {
    // The reason this was blur-only before. A separator appearing to the left
    // of the cursor must not carry the cursor with it: the caret's home is a
    // digit offset, not a character offset.
    let state = EMPTY;
    for (const [i, key] of [..."1234567"].entries()) {
      state = press(state, key);
      expect(digitsBeforeCaret(state)).toBe(i + 1);
    }
    expect(digits(state.value)).toBe("1234567");
  });

  it("holds the caret still when typing into the middle of a number", () => {
    // Insert a digit at the front of an already-grouped number: the grouping
    // shifts by one place under a caret that must stay put.
    const grouped = type("5000");
    const edited = press({ value: grouped.value, caret: 1 }, "1");
    expect(digits(edited.value)).toBe("51000");
    expect(digitsBeforeCaret(edited)).toBe(2);
  });

  it("survives a backspace over a separator", () => {
    // The separator is not the typist's character to delete — stepping back
    // over it has to take a digit with it, or the key appears to do nothing.
    let state = type("12345");
    const before = digits(state.value).length;
    state = backspace(state);
    expect(digits(state.value)).toBe("1234");
    expect(digits(state.value).length).toBe(before - 1);
  });

  it("lets a decimal be typed through, trailing zero and all", () => {
    // A parse-and-reformat round trip eats both the lone point and the
    // trailing zero, which is what makes such a field impossible to type a
    // price into.
    expect(type(`12${decimal}`).value).toBe(`12${decimal}`);
    expect(type(`12${decimal}50`).value).toBe(`12${decimal}50`);
    // And the integer side still groups while the fraction is being typed.
    const long = type(`12345${decimal}5`);
    expect(digits(long.value)).toBe("123455");
    expect(long.value.endsWith(`${decimal}5`)).toBe(true);
  });

  it("hands back anything it cannot read", () => {
    // Same promise as blur: a field that erases a typo is worse than one that
    // shows it.
    expect(regroupWhileTyping("not a number", 3)).toEqual({
      value: "not a number",
      caret: 3,
    });
    expect(regroupWhileTyping(`1${decimal}2${decimal}3`, 5).value).toBe(
      `1${decimal}2${decimal}3`,
    );
    expect(regroupWhileTyping("", 0)).toEqual({ value: "", caret: 0 });
  });

  it("produces something the submit path can read back", () => {
    // The field's contents are the only copy of the value, so whatever this
    // leaves on screen has to survive `parseAmount` on submit.
    expect(parseAmount(type("45000").value)).toBe(45000);
    expect(parseAmount(type(`1234${decimal}5`).value)).toBe(1234.5);
  });
});
