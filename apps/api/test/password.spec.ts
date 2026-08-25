import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_MIN_LENGTH,
  passwordRules,
  passwordMeetsPolicy,
  passwordBits,
  passwordStrength,
  patternedCharacters,
  longestRun,
  passwordSchema,
  RegisterInput,
  type PasswordRuleId,
} from "@gtp/types";

/** The rules that a given password fails, as ids — what the form paints red. */
function unmet(password: string): PasswordRuleId[] {
  return passwordRules(password)
    .filter((r) => !r.met)
    .map((r) => r.id);
}

describe("the password rules", () => {
  /**
   * The worked example from the brief, and the one that pins every rule at
   * once: "1234aA" is meant to show three ticks and two crosses. A single
   * boolean policy could not express that, which is why the rules are a list.
   */
  it("splits 1234aA into three met rules and two unmet", () => {
    assert.deepEqual(unmet("1234aA"), ["length", "special"]);
    assert.equal(passwordMeetsPolicy("1234aA"), false);
  });

  it("passes a password that clears all five", () => {
    assert.deepEqual(unmet("Trip2026!"), []);
    assert.equal(passwordMeetsPolicy("Trip2026!"), true);
  });

  it("counts every rule separately, so nothing is met by accident", () => {
    assert.deepEqual(unmet(""), [
      "length",
      "lowercase",
      "uppercase",
      "number",
      "special",
    ]);
    assert.deepEqual(unmet("aaaaaaaa"), ["uppercase", "number", "special"]);
    assert.deepEqual(unmet("AAAAAAAA"), ["lowercase", "number", "special"]);
    assert.deepEqual(unmet("!!!!!!!!"), ["lowercase", "uppercase", "number"]);
  });

  it("takes the length rule at exactly the minimum, not one past it", () => {
    assert.ok(unmet("a".repeat(PASSWORD_MIN_LENGTH - 1)).includes("length"));
    assert.ok(!unmet("a".repeat(PASSWORD_MIN_LENGTH)).includes("length"));
  });

  /**
   * Hungarian is why the classes are Unicode properties. Under `[a-z]` this
   * password has no lowercase letter at all *and* is credited with a special
   * character for the accents — two wrong answers from one bad assumption.
   */
  it("knows a Hungarian letter is a letter", () => {
    // And note "special" is still unmet: an accent is a letter, not punctuation.
    assert.deepEqual(unmet("őrült"), [
      "length",
      "uppercase",
      "number",
      "special",
    ]);
    assert.deepEqual(unmet("Őrültség9!"), []);
  });

  it("rejects a password too long to hash cheaply", () => {
    assert.equal(passwordMeetsPolicy(`Aa1!${"x".repeat(200)}`), false);
  });
});

describe("scoring a password", () => {
  it("calls a password that fails the gates weak", () => {
    // The same example again, from the other side: three ticks is not a
    // half-good password, and the bar should not imply otherwise.
    assert.equal(passwordStrength("1234aA"), "weak");
    assert.equal(passwordStrength(""), "weak");
    assert.equal(passwordStrength("aaaaaaaa"), "weak");
  });

  it("calls a short-but-varied password normal and a long one strong", () => {
    assert.equal(passwordStrength("Trip2026!"), "normal");
    assert.equal(passwordStrength("Correct-Horse9Battery"), "strong");
  });

  it("grows with length before it grows with variety", () => {
    // Sixteen lowercase letters beat eight characters of four classes, and by a
    // long way: 26^16 against 94^8 is about ten million to one. This is the
    // assertion that failed under a points scheme and is the reason the score
    // is an entropy estimate instead.
    assert.ok(passwordBits("qhtmvbxzrkwdfpsn") > passwordBits("Ab1!Cd2?"));
    assert.equal(passwordStrength("qhtmvbxzrkwdfpsn"), "strong");
    assert.equal(passwordStrength("Ab1!Cd2?"), "normal");
  });

  it("charges a repeated character less than a new one", () => {
    // Both are eight characters over the same alphabet; only one of them is
    // eight independent choices.
    assert.ok(passwordBits("Ab1!Cd2?") > passwordBits("Aa1!Aa1!"));
    assert.equal(passwordStrength("Aa1!Aa1!"), "weak");
  });

  it("never calls a password containing a common word strong", () => {
    assert.equal(passwordStrength("MyPassword2026!!"), "weak");
    assert.equal(passwordStrength("Qwerty-Is-Terrible-2026!"), "weak");
  });

  it("takes back the characters a run or a walk gives away", () => {
    assert.equal(longestRun("aaab"), 3);
    assert.equal(longestRun("abab"), 1);
    // Two characters of "abcd" were guessable from the two before them; a pair
    // is free, because doubled letters happen inside perfectly good passwords.
    assert.equal(patternedCharacters("abcd"), 2);
    assert.equal(patternedCharacters("4321"), 2);
    assert.equal(patternedCharacters("ab"), 0);
    assert.equal(patternedCharacters("acbd"), 0);
    // "abccd" is not one walk: the run breaks at the doubled c.
    assert.equal(patternedCharacters("abccd"), 1);
    assert.ok(passwordBits("Xk9!vbnm") > passwordBits("Xk9!abcd"));
  });

  it("never goes negative, however patterned the password is", () => {
    for (const p of ["", "a", "aaaaaaaaaa", "1234aA", "x".repeat(300)]) {
      assert.ok(passwordBits(p) >= 0, `${p} scored ${passwordBits(p)}`);
    }
  });
});

describe("the registration schema", () => {
  /**
   * The point of the shared module: the schema is not a second copy of the
   * policy that happens to agree today. Anything the rules reject, it rejects.
   */
  it("refuses every password the rules refuse", () => {
    for (const bad of ["1234aA", "short1!", "nouppercase1!", "NOLOWERCASE1!"]) {
      assert.equal(passwordSchema.safeParse(bad).success, false, bad);
    }
    assert.equal(passwordSchema.safeParse("Trip2026!").success, true);
  });

  it("reports every unmet rule at once, not just the first", () => {
    const result = passwordSchema.safeParse("aaaa");
    assert.equal(result.success, false);
    // length, uppercase, number, special — a chain of `.regex()` would have
    // stopped at one and made fixing a password a sequence of guesses.
    assert.equal(result.success ? 0 : result.error.issues.length, 4);
  });

  it("still refuses a weak password through RegisterInput", () => {
    const body = {
      email: "ada@example.com",
      displayName: "Ada",
      password: "1234aA",
    };
    assert.equal(RegisterInput.safeParse(body).success, false);
    assert.equal(
      RegisterInput.safeParse({ ...body, password: "Trip2026!" }).success,
      true,
    );
  });
});
