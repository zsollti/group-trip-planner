/**
 * The currencies a picker offers.
 *
 * **A list, not a validator.** `currencySchema` stays a three-uppercase-letter
 * regex on purpose: this list is a convenience for the person filling in a form,
 * and turning it into an enum would mean a trip denominated in something nobody
 * thought to add here becomes a 400 rather than an unusual choice. It would also
 * make every currency already stored a migration risk the day the list changes.
 * The list is what a `<select>` shows; the regex is what the server accepts.
 *
 * Ordering is deliberate: a short "likely" group first — the currencies a trip
 * planned in Europe is most often priced in — then the rest alphabetically by
 * code. A picker sorted purely alphabetically opens on AED, which is nobody's
 * default.
 *
 * `Intl.NumberFormat` does the symbols and the decimal rules at render time, so
 * nothing here needs to carry a symbol or a minor-unit count that could drift.
 */

export interface CurrencyOption {
  /** ISO-4217 alphabetic code — the value stored and sent. */
  readonly code: string;
  /** English name, shown beside the code so "HUF" is not a guess. */
  readonly name: string;
}

/** Offered first, above a separator, because they cover most trips this app
 *  is used for. Not a judgement about the others — just a shorter scroll. */
export const COMMON_CURRENCY_CODES: readonly string[] = [
  "EUR",
  "USD",
  "GBP",
  "HUF",
  "CHF",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
];

/**
 * ISO-4217 currencies in circulation. Not exhaustive by design — it omits codes
 * for metals, funds and testing (XAU, XDR, XTS and friends), which are valid
 * ISO-4217 and meaningless as a trip's currency.
 */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "AED", name: "UAE Dirham" },
  { code: "ALL", name: "Albanian Lek" },
  { code: "AMD", name: "Armenian Dram" },
  { code: "ARS", name: "Argentine Peso" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "AZN", name: "Azerbaijani Manat" },
  { code: "BAM", name: "Bosnia-Herzegovina Convertible Mark" },
  { code: "BGN", name: "Bulgarian Lev" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CLP", name: "Chilean Peso" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "COP", name: "Colombian Peso" },
  { code: "CRC", name: "Costa Rican Colón" },
  { code: "CZK", name: "Czech Koruna" },
  { code: "DKK", name: "Danish Krone" },
  { code: "DOP", name: "Dominican Peso" },
  { code: "EGP", name: "Egyptian Pound" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound Sterling" },
  { code: "GEL", name: "Georgian Lari" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "HRK", name: "Croatian Kuna" },
  { code: "HUF", name: "Hungarian Forint" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "ILS", name: "Israeli New Shekel" },
  { code: "INR", name: "Indian Rupee" },
  { code: "ISK", name: "Icelandic Króna" },
  { code: "JOD", name: "Jordanian Dinar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "KES", name: "Kenyan Shilling" },
  { code: "KRW", name: "South Korean Won" },
  { code: "KZT", name: "Kazakhstani Tenge" },
  { code: "LKR", name: "Sri Lankan Rupee" },
  { code: "MAD", name: "Moroccan Dirham" },
  { code: "MDL", name: "Moldovan Leu" },
  { code: "MKD", name: "Macedonian Denar" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "PEN", name: "Peruvian Sol" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "PLN", name: "Polish Złoty" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "RON", name: "Romanian Leu" },
  { code: "RSD", name: "Serbian Dinar" },
  { code: "RUB", name: "Russian Ruble" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "THB", name: "Thai Baht" },
  { code: "TND", name: "Tunisian Dinar" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "TWD", name: "New Taiwan Dollar" },
  { code: "UAH", name: "Ukrainian Hryvnia" },
  { code: "USD", name: "US Dollar" },
  { code: "UYU", name: "Uruguayan Peso" },
  { code: "VND", name: "Vietnamese Dong" },
  { code: "ZAR", name: "South African Rand" },
];

/** Look up a currency's name, for a code that may not be in the list. */
export function currencyName(code: string): string | undefined {
  return CURRENCIES.find((c) => c.code === code)?.name;
}

/**
 * The picker's contents: the common codes first, then everything else.
 *
 * A code the app has never heard of — stored before this list existed, or typed
 * by someone the regex was happy to accept — is prepended rather than dropped.
 * A `<select>` whose value is not among its options renders blank and silently
 * rewrites the field on the next save, which is how an edit form quietly changes
 * a trip's currency.
 */
export function currencyChoices(current?: string): {
  readonly common: readonly CurrencyOption[];
  readonly rest: readonly CurrencyOption[];
} {
  const common = COMMON_CURRENCY_CODES.map(
    (code) => CURRENCIES.find((c) => c.code === code) ?? { code, name: code },
  );
  const commonCodes = new Set(COMMON_CURRENCY_CODES);
  const rest = CURRENCIES.filter((c) => !commonCodes.has(c.code));

  if (current && !CURRENCIES.some((c) => c.code === current)) {
    return { common: [{ code: current, name: current }, ...common], rest };
  }
  return { common, rest };
}
