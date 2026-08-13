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
      maximumFractionDigits: 0,
    }).format(amount)} ${currency}`;
  }
}

/** A bare grouped number, for a field that names its currency separately. */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, {
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
 * Regroup what is in an amount field — for `onBlur`, never on keystroke.
 *
 * Grouping as you type fights the caret: inserting a separator to the left of
 * the cursor moves it, and every fix for that is a bigger source of bugs than
 * the problem. On blur the person is done with the field, so there is no caret
 * to fight. Anything unparseable is handed back untouched rather than blanked —
 * losing what someone typed is worse than showing it ungrouped.
 */
export function regroupAmountInput(input: string): string {
  const n = parseAmount(input);
  return n === null ? input : formatAmount(n);
}
