import { Injectable } from "@nestjs/common";
import {
  PLACE_QUERY_MIN_LENGTH,
  PLACE_SEARCH_LIMIT,
  type PlaceSearchResult,
  type PlaceView,
} from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { foldForSearch } from "./places-seed.js";

/**
 * How much an exactly-matching name is worth, as a multiple of population.
 *
 * Fifty, which is the order of magnitude that separates a town from a metropolis
 * — enough that "bath" answers Bath (94k) before Bathinda (285k), and not so
 * much that "york" buries New York City (8.8M) under York, Nebraska (7.8k). A
 * tuned constant, and the two cases either side of it are the test.
 */
const EXACT_BOOST = 50;

/**
 * The destination type-ahead.
 *
 * One query, and it is raw SQL rather than Prisma's query builder for a reason
 * Prisma cannot express: the match runs against a **generated `tsvector`** with a
 * GIN index over it (see the migration), which is what turns "york" into a hit on
 * "New York" — a `contains` filter would be a sequential scan over 74,000 rows on
 * every keystroke, and a `startsWith` would only ever find York.
 *
 * ## Why full text and not a fuzzy match
 *
 * `pg_trgm` would give real fuzziness — "lisbonn" finding Lisbon — and needs
 * `CREATE EXTENSION`, a privilege this app should not demand of whatever Postgres
 * it is pointed at. Word-prefix matching covers what a type-ahead is for: people
 * do not misspell the first four letters of a place they are choosing, they stop
 * typing as soon as they see it.
 *
 * ## Ranking, which is two lines and most of the value
 *
 * Population, with an **exact name multiplied by {@link EXACT_BOOST}**.
 *
 * The obvious version — relevance bands first, population inside each — was
 * tried and is wrong, and the full dataset says so plainly: for "york" it
 * returns York in England, York in Pennsylvania, York in South Carolina, York in
 * Nebraska, then Yorkville and Yorkton, and never reaches New York City. Four
 * towns of eight thousand people ahead of the one place on earth that query
 * usually means.
 *
 * Pure population is wrong the other way: "bath" would answer Bathinda, because
 * it is three times the size of Bath.
 *
 * Multiplying is what holds both. An exact name is worth fifty times its
 * population, so a city named exactly what you typed beats anything merely
 * containing it *unless* that thing is enormous — which is precisely the
 * judgement a reader is making. It is scale-free, so it behaves the same for
 * villages and capitals, and it is one expression over a few hundred rows the
 * index has already found.
 *
 * Deliberately not Postgres' own `ts_rank`, which scores by term frequency in a
 * document — a meaningless measure across two-word place names.
 */
@Injectable()
export class PlacesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Places matching `query`, best first.
   *
   * An empty result is the honest answer to a short query and to an unseeded
   * database alike. Nothing here throws for either: the picker in front of this
   * accepts free text, so "no suggestions" degrades to the behaviour the form
   * had before this table existed.
   */
  async search(query: string): Promise<PlaceSearchResult> {
    const folded = foldForSearch(query.trim());
    if (folded.length < PLACE_QUERY_MIN_LENGTH) return { places: [] };

    /*
     * The query, as a `tsquery` built from the terms rather than from the string.
     *
     * `to_tsquery` parses operators — an ampersand, a bang or a stray colon in
     * user input is a syntax error, and a syntax error from a keystroke is a 500.
     * So the words are extracted, escaped to nothing, and joined with `&`
     * ourselves: every term must appear, each matched as a prefix. That is what
     * makes "lisbon portug" work, which is how people type a place they are
     * unsure of.
     *
     * `plainto_tsquery` would have been the safe built-in, and it cannot do the
     * prefix half — it matches whole lexemes only, so "lisb" would find nothing.
     */
    const terms = folded
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0)
      .slice(0, 6);
    if (terms.length === 0) return { places: [] };
    const tsquery = terms.map((t) => `${t}:*`).join(" & ");

    const rows = await this.prisma.$queryRaw<
      {
        geonameId: number;
        kind: PlaceView["kind"];
        name: string;
        admin1Name: string | null;
        countryCode: string;
        countryName: string;
        currencyCode: string | null;
        timezone: string | null;
        latitude: number | null;
        longitude: number | null;
      }[]
    >`
      SELECT p."geonameId", p."kind", p."name", p."admin1Name",
             p."countryCode", c."name" AS "countryName", c."currencyCode",
             p."timezone", p."latitude", p."longitude"
      FROM "places" p
      JOIN "countries" c ON c."code" = p."countryCode"
      WHERE p."searchVector" @@ to_tsquery('simple', ${tsquery})
      ORDER BY
        p."population" *
          CASE WHEN lower(p."asciiName") = ${folded} THEN ${EXACT_BOOST} ELSE 1 END
          DESC,
        p."geonameId"
      LIMIT ${PLACE_SEARCH_LIMIT}
    `;

    return {
      places: rows.map((r) => ({
        id: r.geonameId,
        kind: r.kind,
        name: r.name,
        region: r.admin1Name,
        countryCode: r.countryCode,
        countryName: r.countryName,
        currencyCode: r.currencyCode,
        timezone: r.timezone,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
    };
  }

  /**
   * The facts a trip copies when a place is chosen, or null if the id is unknown.
   *
   * Read here rather than trusted from the client, and it is the whole reason the
   * request sends an id and nothing else: a browser that could name a place's
   * timezone could name the wrong one, and the trip would then be planned around
   * a clock nobody could account for.
   *
   * An unknown id resolves to null and the caller treats the destination as typed
   * — which is what happens when a stale tab submits an id from a dataset the
   * server has since re-seeded past.
   */
  async facts(placeId: number): Promise<{
    timezone: string | null;
    latitude: number | null;
    longitude: number | null;
    currencyCode: string | null;
  } | null> {
    const place = await this.prisma.place.findUnique({
      where: { geonameId: placeId },
      select: {
        timezone: true,
        latitude: true,
        longitude: true,
        country: { select: { currencyCode: true } },
      },
    });
    if (!place) return null;
    return {
      timezone: place.timezone,
      latitude: place.latitude,
      longitude: place.longitude,
      currencyCode: place.country.currencyCode,
    };
  }
}
