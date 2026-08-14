/**
 * Money, as a reader sees it.
 *
 * "45000" is a number a computer wrote. Every language groups long digits for
 * exactly the reason this exists — four digits are read at a glance, six are
 * counted — and `Intl` already knows how each one does it, including *which*
 * separator: a Hungarian reader gets `45 000`, an American `45,000`, a German
 * `45.000`. Hard-coding a space would be right here and wrong in most places,
 * and the app already formats its dates in the reader's own locale.
 *
 * The server stores and sends plain numbers. All of this is render-time.
 */

/**
 * Group from **four digits up**, everywhere, in whatever way the reader's
 * locale groups.
 *
 * `Intl`'s default is `"auto"`, which defers to the locale's
 * `minimumGroupingDigits` — and a good half of Europe, Hungarian included, sets
 * that to two, meaning `5000` is written bare and only `45 000` gets a
 * separator. That is correct for prose and wrong for a column of prices, where
 * the whole reason to group is that the eye should not have to count digits;
 * `5000` beside `45 000` is exactly the comparison that gets misread.
 *
 * Stated once and shared, because the moment the field that *takes* an amount
 * disagrees with the card that *shows* it, one of them looks broken — and the
 * field is the one people would blame, since it appears to ungroup a number as
 * they leave it.
 */
const GROUPING = { useGrouping: "always" } as const;

/**
 * A currency amount with its symbol, grouped — "€620", "45 000 Ft", "$1,299.50".
 *
 * Cents appear only when the amount has them. A trip's prices are mostly round
 * numbers and a column of `.00` is noise; a fare that really is €37.50 still
 * shows as €37.50.
 *
 * Falls back to "<amount> <CODE>" for a code `Intl` does not know (FR-27 —
 * `currencySchema` accepts any three letters, so this has to be total).
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      ...GROUPING,
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${formatAmount(amount)} ${currency}`;
  }
}

/**
 * An **approximate** amount — "≈ €1,240", never "≈ €1,239.87".
 *
 * Rounded to whole units on purpose. Cents on a converted figure claim a
 * precision the rate does not have: it comes from one daily snapshot and is
 * offered as roughly-what-this-costs, so writing it to the penny would dress a
 * guess as a measurement. The exact per-currency figures are on the same screen
 * for anyone who needs one.
 *
 * The `≈` is not decoration either — it is the only thing distinguishing this
 * from the exact totals beside it.
 */
export function formatApproxMoney(amount: number, currency: string): string {
  try {
    return `≈ ${new Intl.NumberFormat(undefined, {
      ...GROUPING,
      style: "currency",
      currency,
      // Both bounds stated, like `formatMoney` above. A currency carries its
      // own default minimum — two for the euro — and giving only a maximum
      // leaves `Intl` to clamp that default down to meet it. It does, but
      // silently relying on that is how someone later adds a minimum and gets
      // a `RangeError` instead of a rounded figure.
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)}`;
  } catch {
    return `≈ ${new Intl.NumberFormat(undefined, {
      ...GROUPING,
      maximumFractionDigits: 0,
    }).format(amount)} ${currency}`;
  }
}

/** A bare grouped number, for a field that names its currency separately. */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    ...GROUPING,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * The reader's group and decimal separators, asked of `Intl` rather than
 * assumed. Guessing is how you get a parser that treats the German "1.234" as
 * one-point-two-three-four.
 */
function separators(): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(undefined).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

/**
 * Read a number back out of whatever a person typed or the field last showed.
 *
 * It reads **one locale's conventions — the reader's own**. Strip that locale's
 * group separator, normalise its decimal separator, and what is left is a
 * number. So the grouped form this module produces round-trips, and plain
 * digits always work.
 *
 * It deliberately does **not** also treat a comma as a decimal point "to be
 * helpful". That looks generous and is a silent corruption: where the comma is
 * the *group* separator, `12,50` has already been stripped to `1250` by the
 * time such a rule could fire, so the same input means twelve-and-a-half in
 * Budapest and one thousand two hundred and fifty in Boston. There is no
 * reading of `12,50` that is right in both places, and the one thing worse than
 * refusing an amount is accepting it as a different amount. Each locale's own
 * conventions work; nobody's are quietly reinterpreted.
 *
 * Returns `null` for anything that isn't a number, which is the caller's cue to
 * leave the field alone.
 */
export function parseAmount(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const { group, decimal } = separators();
  // `\s` covers the ordinary space and the non-breaking and narrow no-break
  // spaces several locales group with — which is also why they are matched by
  // class rather than written out as literal characters.
  const stripped = trimmed
    .split(group)
    .join("")
    .replace(/\s/g, "")
    .replace(decimal, ".");

  if (!/^-?\d*\.?\d*$/.test(stripped) || stripped === ".") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Regroup what is in an amount field, on blur.
 *
 * Anything unparseable is handed back untouched rather than blanked — losing
 * what someone typed is worse than showing it ungrouped. Still worth keeping
 * alongside {@link regroupWhileTyping}: that one preserves the fraction exactly
 * as typed, so `12.50` stays `12.50` mid-edit, and blur is where a finished
 * value gets its canonical form.
 */
export function regroupAmountInput(input: string): string {
  const n = parseAmount(input);
  return n === null ? input : formatAmount(n);
}

/** An amount field's contents and where the caret sits in them. */
export interface AmountFieldState {
  readonly value: string;
  readonly caret: number;
}

/**
 * Regroup an amount **on every keystroke** — `500` becomes `5 000` as the
 * fourth digit lands, not later.
 *
 * This used to be a blur-only job, on the reasoning that grouping while typing
 * fights the caret: a separator inserted to the left of the cursor pushes the
 * cursor, and the field reads as if it were typing back at you. That reasoning
 * was right about the failure and wrong about the fix. **The caret's position
 * is not a character offset, it is a digit offset** — someone typing the fourth
 * digit of `5000` is after their fourth digit, and stays after their fourth
 * digit whether or not the field has since put a space at position one. Count
 * the digits to the left, reformat, then find that many digits into the result,
 * and the separators can appear and disappear underneath a caret that never
 * moves.
 *
 * Two things are deliberately preserved rather than normalised:
 *
 * - **The fraction, exactly as typed.** Grouping only ever touches the integer
 *   part, so a half-typed `12.` keeps its point and `12.50` keeps its trailing
 *   zero — both of which a parse-and-reformat round trip eats, which is what
 *   makes decimals impossible to type into a field that reformats itself.
 * - **Anything it cannot read.** Same rule as blur: hand it back untouched. A
 *   field that erases a typo is worse than one that shows it.
 */
export function regroupWhileTyping(
  input: string,
  caret: number,
): AmountFieldState {
  const { group, decimal } = separators();

  // The digits, the point and the sign — the characters that *mean* something.
  // Everything else in the field is presentation this function owns and is
  // free to move, which is exactly why the caret is counted against these.
  const meaningful = (s: string) =>
    [...s].filter((c) => /\d/.test(c) || c === decimal || c === "-").length;
  const unchanged = { value: input, caret };

  // Looser than `parseAmount` on purpose: this runs on a half-typed value, so
  // it has to accept "12." and "-" as work in progress while still refusing
  // anything that is not on its way to being a number.
  const bare = input.split(group).join("").replace(/\s/g, "");
  const parts = bare.split(decimal);
  if (parts.length > 2) return unchanged;
  const [whole = "", fraction] = parts;
  if (fraction !== undefined && !/^\d*$/.test(fraction)) return unchanged;
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  if (!/^\d*$/.test(digits)) return unchanged;

  // `Intl` does the grouping, because *where* the separators fall is as local
  // as which character they are — not every locale groups in threes. BigInt so
  // a pasted twenty-digit number gets regrouped instead of rounded off into
  // scientific notation.
  let grouped = digits;
  if (digits !== "") {
    try {
      grouped = new Intl.NumberFormat(undefined, {
        ...GROUPING,
        maximumFractionDigits: 0,
      }).format(BigInt(digits));
    } catch {
      return unchanged;
    }
  }

  const value =
    (negative ? "-" : "") +
    grouped +
    (fraction === undefined ? "" : decimal + fraction);
  if (value === input) return unchanged;

  // Walk the new text until as many meaningful characters have gone by as sat
  // to the left of the caret in the old.
  const target = meaningful(input.slice(0, caret));
  let seen = 0;
  let next = value.length;
  for (let i = 0; i < value.length; i += 1) {
    if (seen === target) {
      next = i;
      break;
    }
    const c = value[i] as string;
    if (/\d/.test(c) || c === decimal || c === "-") seen += 1;
  }
  return { value, caret: next };
}
