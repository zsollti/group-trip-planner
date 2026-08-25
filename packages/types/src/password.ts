/**
 * What makes a password acceptable, and how good it is — as pure functions
 * both sides run.
 *
 * The registration form draws a live checklist and a strength bar from these,
 * and `passwordSchema` (in `auth.ts`) is built out of the very same rules. That
 * is the whole reason this is a module and not a regex in a component: a client
 * that drew five green ticks over a policy the server did not hold would be
 * decoration, and a server rule the form never mentioned would be a 400 with no
 * explanation. One list, two readers.
 *
 * **Rules and strength are different questions and are kept apart.** A rule is
 * a gate — it passes or it does not, and failing one means the account cannot
 * be created. Strength is advice: "Trip2026!" clears every rule and is still
 * not a good password, and a bar that only ever said "strong" the moment the
 * gates opened would be lying to exactly the people who most need telling.
 */

/** The shortest password this app will take. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * The longest. Not a policy so much as a guard on hashing cost — Argon2 over a
 * megabyte of text is a denial-of-service someone else pays for.
 */
export const PASSWORD_MAX_LENGTH = 128;

/** The five gates, as ids the UI can label and order. */
export type PasswordRuleId =
  "length" | "lowercase" | "uppercase" | "number" | "special";

/** One gate's verdict on one password. */
export interface PasswordRule {
  readonly id: PasswordRuleId;
  readonly met: boolean;
}

/**
 * The character classes, as Unicode properties rather than `[a-z]`.
 *
 * This app is read in Hungarian as well as English, and `[a-z]` does not
 * contain `ő`. Under the ASCII ranges a Hungarian password made of Hungarian
 * letters would be told it has no lowercase letter *and* credited with a
 * special character for the accent — two wrong answers from one bad
 * assumption. `\p{Ll}` and `\p{Lu}` know what a letter is in every script,
 * which is what the sentence "a small and a big letter" actually means.
 *
 * "Special" is then defined by what it is *not* — anything that is neither a
 * letter nor a number — so punctuation, symbols and spaces all count without
 * anyone having to enumerate a keyboard.
 */
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const NUMBER = /\p{N}/u;
const SPECIAL = /[^\p{L}\p{N}]/u;

/**
 * Every rule's verdict, in the order they are shown.
 *
 * Always all five, met or not — the form draws the unmet ones in red, so a list
 * that shrank as they were satisfied would take away the instruction at the
 * moment it was being followed.
 */
export function passwordRules(password: string): readonly PasswordRule[] {
  return [
    { id: "length", met: password.length >= PASSWORD_MIN_LENGTH },
    { id: "lowercase", met: LOWERCASE.test(password) },
    { id: "uppercase", met: UPPERCASE.test(password) },
    { id: "number", met: NUMBER.test(password) },
    { id: "special", met: SPECIAL.test(password) },
  ];
}

/** Does this password clear every gate? */
export function passwordMeetsPolicy(password: string): boolean {
  return (
    password.length <= PASSWORD_MAX_LENGTH &&
    passwordRules(password).every((r) => r.met)
  );
}

/** How good a password is, once it is allowed at all. */
export type PasswordStrength = "weak" | "normal" | "strong";

/**
 * Words that make a password guessable no matter what else is in it.
 *
 * Short on purpose. A real breach-corpus check belongs on a server with the
 * corpus, and shipping fifty thousand entries to a sign-up form would cost more
 * than it caught; this is the handful that sit at the top of every leaked list,
 * and its job is to stop "Password1!" being called strong for clearing five
 * gates.
 */
const COMMON = [
  "password",
  "qwerty",
  "letmein",
  "welcome",
  "iloveyou",
  "admin",
  "monkey",
  "dragon",
  "abc123",
];

/** The longest run of one repeated character - "aaab" is 3. */
export function longestRun(password: string): number {
  let best = 0;
  let run = 0;
  let previous = "";
  for (const ch of password) {
    run = ch === previous ? run + 1 : 1;
    previous = ch;
    if (run > best) best = run;
  }
  return best;
}

/**
 * How many characters a password gives away to runs and walks.
 *
 * A guesser who has seen "abc" has a very good idea what the fourth character
 * is, and the same goes for "aaa". So every character that merely continues
 * such a run is subtracted from the length the entropy estimate may use - which
 * is the honest way to express a pattern's cost, because that is precisely what
 * it is: not a fixed penalty, but the characters that stopped being choices.
 *
 * Only runs of **three or more** count, so the ordinary accident - a doubled
 * letter, two neighbouring letters inside a real word - is free.
 */
export function patternedCharacters(password: string): number {
  const codes = [...password.toLowerCase()].map((c) => c.codePointAt(0)!);
  let given = 0;
  let run = 1;
  let step = 0;
  for (let i = 1; i < codes.length; i += 1) {
    const d = codes[i]! - codes[i - 1]!;
    const walks = d === 0 || d === 1 || d === -1;
    if (!walks) {
      run = 1;
    } else if (run > 1 && d === step) {
      run += 1;
    } else {
      run = 2;
      step = d;
    }
    if (run >= 3) given += 1;
  }
  return given;
}

/** How many distinct characters a password is built from. */
function uniqueCount(password: string): number {
  return new Set([...password]).size;
}

/** The size of the alphabet the password appears to have been drawn from. */
function alphabetSize(password: string): number {
  let size = 0;
  if (LOWERCASE.test(password)) size += 26;
  if (UPPERCASE.test(password)) size += 26;
  if (NUMBER.test(password)) size += 10;
  /*
   * Roughly the printable punctuation on a keyboard, and deliberately not the
   * enormous range a letters-and-numbers-negated class technically admits:
   * crediting someone with a million-symbol alphabet for typing one emoji would
   * be arithmetic rather than security.
   */
  if (SPECIAL.test(password)) size += 32;
  return size;
}

/**
 * Roughly how many bits of guessing a password is worth.
 *
 * `length x log2(alphabet)` is the standard estimate, and everything
 * interesting is in what gets taken off the length first:
 *
 *  - **patterns** ({@link patternedCharacters}) - the characters a guesser did
 *    not have to guess;
 *  - **repetition** - a character used again adds less than a new one, so
 *    repeats count half. This is what stops "Aa1!Aa1!" scoring like eight
 *    independent choices.
 *
 * Doing it this way rather than with a bucket of hand-tuned points fixes what
 * points got wrong: sixteen lowercase letters really are far harder to guess
 * than eight characters of full keyboard (26^16 against 94^8, about ten million
 * to one), and any scheme paying a flat bonus per character class says the
 * opposite.
 */
export function passwordBits(password: string): number {
  if (password.length === 0) return 0;

  const unique = uniqueCount(password);
  const repeated = password.length - unique;
  const effective = Math.max(
    0,
    unique + repeated / 2 - patternedCharacters(password),
  );
  const bits = effective * Math.log2(alphabetSize(password) || 1);

  const lower = password.toLowerCase();
  // Capped rather than zeroed: "Password" is still better than "aaaa", and a
  // scale that flattens everything guessable into one bucket stops being
  // advice. It simply cannot come out strong.
  if (COMMON.some((word) => lower.includes(word))) return Math.min(bits, 20);
  return bits;
}

/**
 * Where the bar's three words begin.
 *
 * 45 bits is about where an offline attack on a well-hashed password stops
 * being an afternoon; 70 is where it stops being worth starting. Both are
 * exported because the meter fills a fraction of the upper one, and a bar whose
 * fill disagreed with its own label would be worse than either alone.
 */
export const PASSWORD_NORMAL_BITS = 45;
export const PASSWORD_STRONG_BITS = 70;

/** The word under the bar. */
export function passwordStrength(password: string): PasswordStrength {
  const bits = passwordBits(password);
  if (bits >= PASSWORD_STRONG_BITS) return "strong";
  if (bits >= PASSWORD_NORMAL_BITS) return "normal";
  return "weak";
}
