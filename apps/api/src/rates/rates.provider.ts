import { z } from "zod";

/**
 * The reference-rate feed adapter (post-launch).
 *
 * One HTTP call, one shape, validated on arrival. Kept apart from the service
 * that stores the result so the storage rules can be tested without a network
 * and this can be tested without a database.
 *
 * **The feed is keyless on purpose.** The European Central Bank's daily
 * reference rates, served here by frankfurter.app, need no account and no API
 * key — nothing to leak, nothing to rotate, nothing to expire quietly eighteen
 * months from now on a portfolio project. The price is coverage: the ECB
 * publishes around thirty currencies against the sixty-three the picker offers,
 * so "no rate for this currency" is an ordinary state the whole feature is
 * built to say out loud rather than an error.
 */

/** What the feed returns: a base, a publication date, and units-per-base. */
const RatesResponse = z.object({
  base: z.string(),
  /** The source's own publication date (YYYY-MM-DD), not the time of the call. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date"),
  rates: z.record(
    z.string().regex(/^[A-Z]{3}$/),
    // A rate must be a usable positive number. A zero would convert every
    // amount in that currency to nothing, which reads as "free" rather than
    // "unknown", so it is refused at the door rather than stored.
    z.number().positive().finite(),
  ),
});

export interface RateSnapshot {
  /** Publication date, ISO `YYYY-MM-DD`. */
  readonly asOf: string;
  /** Units per one EUR, by ISO code. Never includes EUR itself. */
  readonly rates: Readonly<Record<string, number>>;
}

/** Injection token, so a test supplies its own fetcher instead of a network. */
export const RATES_PROVIDER = Symbol("RATES_PROVIDER");

export interface RatesProvider {
  /** Fetch the latest published rates, or throw. */
  fetchLatest(): Promise<RateSnapshot>;
}

/**
 * Read the feed over HTTP.
 *
 * Throws on anything unexpected — a non-200, a malformed body, a base that is
 * not the pivot we quote against. The caller's job is to keep the last good
 * rates when that happens; this one's is to refuse to return a bad snapshot.
 */
export class HttpRatesProvider implements RatesProvider {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async fetchLatest(): Promise<RateSnapshot> {
    // A hung request must not hold a boot hook or a cron tick open forever.
    const response = await fetch(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`rate feed answered ${response.status}`);
    }

    const body = RatesResponse.parse(await response.json());
    if (body.base !== "EUR") {
      // Every stored rate means "units per one EUR". A feed that quoted
      // something else would be silently wrong in every conversion, so this is
      // checked rather than assumed.
      throw new Error(`rate feed is based on ${body.base}, expected EUR`);
    }
    // The base is 1 by definition and is never stored; drop it if the feed
    // echoes it back.
    const rates = { ...body.rates };
    delete rates.EUR;
    return { asOf: body.date, rates };
  }
}
