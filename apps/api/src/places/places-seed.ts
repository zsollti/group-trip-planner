import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Load the gazetteer: ~74,000 places and 250 countries.
 *
 * Reads the **committed** dataset under `prisma/data/`, never the network — see
 * `prisma/places-fetch.ts` for what builds that file and why the two are
 * separate. A deploy that had to reach download.geonames.org would be a deploy
 * that fails when somebody else's server is down.
 *
 * **Idempotent, and cheap to re-run.** Rows are keyed by GeoNames' own id, so a
 * newer dump updates in place: a renamed town changes its row and a trip
 * pointing at it keeps pointing at it. Nothing here deletes, deliberately — a
 * place that has fallen out of a newer dump is still a place somebody's trip
 * refers to.
 *
 * Two callers, like the demo seed:
 *
 *  - `prisma/places-seed.ts`, the CLI (`pnpm --filter @gtp/api places:seed`);
 *  - and nothing else yet. It is deliberately **not** wired into application
 *    boot: seventy thousand rows on every start would slow the API's readiness
 *    for a table that changes once a year, and it would put the cost on every
 *    test run.
 *
 * The API tolerates the table being empty. `/places` simply matches nothing, and
 * the picker in front of it still accepts free text — which is what makes an
 * unseeded database a degraded experience rather than a broken one.
 *
 * Data © GeoNames, CC BY 4.0.
 */

/**
 * Where the committed dataset lives, found by walking up rather than counted.
 *
 * This module is executed from three different depths and a fixed `../../` is
 * only right for two of them: `src/places/` when the CLI runs it under
 * `--experimental-strip-types`, `dist/places/` in the production image, and
 * `dist-test/src/places/` under the test build — which is one level deeper,
 * because that build keeps the `src` prefix. The relative path was written for
 * the first two and failed on the third with an ENOENT for a file that is
 * plainly there.
 *
 * So it looks for the directory instead of asserting where it is, and stopping
 * at the first hit means a fourth layout costs nothing.
 *
 * No decorators and no compiled imports anywhere in this file: the CLI runs it
 * under `--experimental-strip-types`, which strips types and refuses anything
 * needing real transformation.
 */
function findDataDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 5; up += 1) {
    const candidate = join(dir, "prisma", "data");
    if (existsSync(join(candidate, "countries.tsv"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    "Could not find prisma/data — is the dataset committed and copied into the build?",
  );
}

export interface PlacesSeedSummary {
  countries: number;
  places: number;
  /** How many of those are regions and countries rather than towns. */
  regions: number;
  nations: number;
}

/**
 * Fold a name into something a query can match.
 *
 * Lowercased and stripped of diacritics, so "Malmö" is reachable by typing
 * "Malmo" — which is what somebody without those keys will type. Done here, in
 * JavaScript, rather than in SQL: Postgres folds accents with the `unaccent`
 * extension, and requiring `CREATE EXTENSION` of whatever database this app is
 * pointed at is a privilege it should not need.
 *
 * NFD splits a letter from its accent and the range strips the accents, which
 * covers the Latin alphabets this dataset is filtered to. Exported because the
 * search endpoint has to fold the *query* by exactly the same rule — two
 * different foldings would mean a term that matches nothing it should.
 */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * One line of the dataset, which is strings all the way down.
 *
 * Typed as such on purpose: the columns are text until something converts them,
 * and the conversions are visible below. Declaring `geonameId: number` here and
 * casting the parsed record to it type-checked and then handed Prisma a string,
 * which is the sort of lie a cast over a `Record<string, string>` makes easy.
 */
interface Row {
  geonameId: string;
  kind: "CITY" | "REGION" | "COUNTRY";
  name: string;
  asciiName: string;
  altNames: string;
  countryCode: string;
  admin1Code: string;
  latitude: string;
  longitude: string;
  timezone: string;
  population: string;
}

/** How many rows go in one statement. Large enough to be fast, small enough to
 *  stay well inside Postgres' parameter limit at twelve columns a row. */
const CHUNK = 2000;

export async function seedPlaces(
  prisma: PrismaClient,
): Promise<PlacesSeedSummary> {
  // ------------------------------------------------------------- countries ---
  const countryLines = readFileSync(
    join(findDataDir(), "countries.tsv"),
    "utf8",
  )
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() !== "");
  const countries: Prisma.CountryCreateManyInput[] = countryLines.map((l) => {
    const [code, name, currencyCode] = l.split("\t");
    return {
      code: code!,
      name: name!,
      currencyCode: currencyCode ? currencyCode : null,
    };
  });

  // Countries first, and in one statement: every place row carries a foreign key
  // to one, so the order is not a preference.
  await prisma.country.createMany({ data: countries, skipDuplicates: true });

  // ---------------------------------------------------------------- places ---
  const text = gunzipSync(
    readFileSync(join(findDataDir(), "places.tsv.gz")),
  ).toString("utf8");
  const lines = text.split("\n");
  const header = lines[0]!.split("\t");
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const f = line.split("\t");
    const row: Partial<Record<keyof Row, string>> = {};
    header.forEach((h, i) => (row[h as keyof Row] = f[i] ?? ""));
    rows.push(row as Row);
  }

  /*
   * A region's display name, looked up before anything is written.
   *
   * Every city carries the name of the region it sits in, so "Springfield" can
   * be told from "Springfield" on screen. Denormalised rather than joined,
   * because it is wanted on every row of every type-ahead response and joining
   * a 74,000-row table to itself on two text columns for that is a cost paid per
   * keystroke.
   */
  const regionNames = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === "REGION") {
      regionNames.set(`${r.countryCode}.${r.admin1Code}`, r.name);
    }
  }

  const known = new Set(countries.map((c) => c.code));
  const data: Prisma.PlaceCreateManyInput[] = [];
  for (const r of rows) {
    // A place whose country is not in `countryInfo.txt` — a handful of disputed
    // and dissolved territories. Skipped rather than given a null country: the
    // foreign key is what lets a currency be looked up at all.
    if (!known.has(r.countryCode)) continue;
    const alts = r.altNames ? r.altNames.split("|") : [];
    data.push({
      geonameId: Number(r.geonameId),
      kind: r.kind,
      name: r.name,
      asciiName: r.asciiName,
      altNames: r.altNames,
      countryCode: r.countryCode,
      admin1Code: r.admin1Code,
      admin1Name:
        r.kind === "CITY"
          ? (regionNames.get(`${r.countryCode}.${r.admin1Code}`) ?? null)
          : null,
      latitude: r.latitude ? Number(r.latitude) : null,
      longitude: r.longitude ? Number(r.longitude) : null,
      timezone: r.timezone ? r.timezone : null,
      population: Number(r.population) || 0,
      // Every form somebody might type, folded and run together. The region and
      // country names go in too, so "lisbon portugal" finds Lisbon — which is
      // how people type a place they are not sure how to spell.
      searchText: foldForSearch(
        [
          r.name,
          r.asciiName,
          ...alts,
          r.kind === "CITY"
            ? (regionNames.get(`${r.countryCode}.${r.admin1Code}`) ?? "")
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    });
  }

  /*
   * Emptied and rewritten, rather than upserted row by row.
   *
   * Seventy-four thousand upserts is seventy-four thousand round trips; this is
   * forty statements. The delete is safe precisely because nothing references
   * these rows — `Trip.destinationPlaceId` is deliberately not a foreign key
   * (see the schema) — so clearing the table cannot touch a trip.
   */
  await prisma.place.deleteMany({});
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.place.createMany({ data: data.slice(i, i + CHUNK) });
  }

  return {
    countries: countries.length,
    places: data.length,
    regions: data.filter((p) => p.kind === "REGION").length,
    nations: data.filter((p) => p.kind === "COUNTRY").length,
  };
}
