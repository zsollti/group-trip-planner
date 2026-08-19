import { z } from "zod";

/**
 * Places, for the one question the create-trip form asks and could not answer:
 * *where*.
 *
 * The destination was free text. That is right in one respect and wrong in
 * every other: right because a group going to "Dad's cabin" must not be turned
 * away by a gazetteer, wrong because a typed string is a string — it cannot tell
 * the form which currency to default to, cannot tell the itinerary which clock
 * the trip runs on, and cannot be told apart from the same words typed
 * differently.
 *
 * So the destination is now **chosen from a list that still accepts anything**.
 * `Trip.destination` remains the free-text display string; a `destinationPlaceId`
 * beside it records that it resolved to somewhere known, and the timezone and
 * coordinates are copied across at the moment of choosing.
 *
 * Data © GeoNames, CC BY 4.0 — see `docs/decisions.md`.
 */

/**
 * What kind of thing a place is.
 *
 * All three are legitimate destinations and the picker offers all three: most
 * trips go to a city, some go to a region ("Tuscany") and some to a country, and
 * a list of cities only would send the last two back to free text.
 */
export const PLACE_KINDS = ["CITY", "REGION", "COUNTRY"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** One suggestion, as the picker draws it. */
export const PlaceView = z.object({
  /** GeoNames' id. Stable across dumps, which is why it is what a trip stores. */
  id: z.number().int(),
  kind: z.enum(PLACE_KINDS),
  /** The canonical name, and the only one shown. */
  name: z.string(),
  /**
   * The region this sits in, where that is a different thing from the place
   * itself. Present on cities and null on regions and countries — "Tuscany,
   * Tuscany" would be the label a naive join produces.
   */
  region: z.string().nullable(),
  /** ISO-3166 alpha-2. The picker computes a flag from it; nothing is stored. */
  countryCode: z.string(),
  /** The country's own name, spelled out, because two letters are not a place. */
  countryName: z.string(),
  /**
   * The currency of the country this is in, when GeoNames names one.
   *
   * This is the field that makes the whole table pay for itself: the create-trip
   * form asks for a destination and then, separately, for a currency, and having
   * been told "Lisbon, Portugal" it can answer the second question itself.
   */
  currencyCode: z.string().nullable(),
  /** IANA zone. Sent, stored, and not yet read — see `Trip.destinationTimezone`. */
  timezone: z.string().nullable(),
  /** Cities only. A country is not a point. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type PlaceView = z.infer<typeof PlaceView>;

/**
 * How a place reads on one line: "Lisbon, Portugal", "Tallinn, Harjumaa, Estonia".
 *
 * The string a picker shows **and** the string written into the trip's
 * `destination` when a suggestion is taken. Those have to be one function, or
 * choosing a suggestion silently changes what you picked.
 *
 * It lived in `@gtp/api-client` until the demo seed needed it, and a seed cannot
 * import a package built on React Query. Here is where it always belonged: it is
 * a pure rule over a contract type, with no more claim on the browser than
 * `PlaceView` itself has. The api-client still re-exports it, so its callers did
 * not have to care.
 *
 * The region is dropped when it repeats the name, which happens constantly:
 * Lisbon sits in Lisbon, Vienna in Vienna, and "Vienna, Vienna, Austria" reads
 * as a bug rather than as precision.
 */
export function placeLabel(
  place: Pick<PlaceView, "name" | "region" | "countryName">,
): string {
  const parts = [place.name];
  if (place.region && !sameWord(place.region, place.name)) {
    parts.push(place.region);
  }
  if (!sameWord(place.countryName, place.name)) parts.push(place.countryName);
  return parts.join(", ");
}

/**
 * Case-folded equality, and nothing looser. "Lisboa" and "Lisbon" are different
 * names to a reader and both are worth printing; only a literal repeat is noise.
 */
function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** A page of suggestions. Never paged — a type-ahead that scrolls is a list. */
export const PlaceSearchResult = z.object({
  places: z.array(PlaceView),
});
export type PlaceSearchResult = z.infer<typeof PlaceSearchResult>;

/** The fewest characters worth a query. Below this every answer is noise. */
export const PLACE_QUERY_MIN_LENGTH = 2;
/** How many suggestions a picker shows. More is a list nobody reads to the end. */
export const PLACE_SEARCH_LIMIT = 8;

/**
 * How a trip refers to a chosen place.
 *
 * Sent alongside `destination` rather than instead of it, and every field is
 * optional: a trip may have a destination and no place, which is exactly what
 * happens when somebody types one. The client sends the id and the server reads
 * the rest of the facts out of its own table — a client that could name its own
 * timezone for a place could name a wrong one.
 */
export const TripPlaceInput = z.object({
  destinationPlaceId: z.number().int().nullable().optional(),
});
export type TripPlaceInput = z.infer<typeof TripPlaceInput>;
