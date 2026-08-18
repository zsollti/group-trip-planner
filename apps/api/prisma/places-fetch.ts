/**
 * Rebuild the committed place dataset from GeoNames.
 *
 * **A development script, run by hand, not by a build.** It reaches the network
 * and the deploy pipeline must not: the output is committed
 * (`prisma/data/places.tsv.gz`) and the seeder reads that, so a release never
 * depends on download.geonames.org being up, and the test suite never depends on
 * a network at all. Place names change slowly; re-run this once a year.
 *
 *   pnpm --filter @gtp/api places:fetch
 *
 * ## What it takes, and what it leaves
 *
 * Three files from the GeoNames dump:
 *
 *  - `cities5000.zip` — every populated place over 5,000 people (~70k). The full
 *    `allCountries` dump has 4.8M, which is mostly hamlets nobody plans a trip
 *    to; five thousand is the cut where "everywhere a group actually goes" stops
 *    and "a farm with a name" begins.
 *  - `admin1CodesASCII.txt` — the first administrative level (~3.9k). This is
 *    what makes "Tuscany" and "Bavaria" selectable, and it is also what
 *    disambiguates a city: "Springfield" means nothing, "Springfield, Illinois"
 *    does.
 *  - `countryInfo.txt` — the 250 countries, with the field that pays for this
 *    whole exercise: each one's **currency code**.
 *
 * Nine columns survive per place. Dropped on purpose: elevation and DEM (no
 * use), admin2/3/4 (disambiguation past the state is noise), `cc2`, and the
 * modification date.
 *
 * ## Alternate names
 *
 * Kept, but only the Latin-script ones and only five per place — enough that a
 * Hungarian typing "Bécs" finds Vienna, which is the case this app actually has.
 * The full field runs to every script on earth and would treble the file for
 * readers this app does not have. They are **search keys only**: the board
 * always displays the canonical name, because translating proper nouns per
 * locale is a different decision and a much larger one.
 *
 * ## Licence
 *
 * The GeoNames dumps are CC BY 4.0. Attribution is a condition, not a courtesy,
 * and this repo is public — see `docs/decisions.md` and the app's own footer.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, inflateRawSync } from "node:zlib";

const BASE = "https://download.geonames.org/export/dump";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "data");

/** Latin script, tested by codepoint range rather than by Unicode name lookup. */
function isLatin(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    // Not a letter at all (space, hyphen, digit, apostrophe) — allowed.
    if (!/\p{L}/u.test(ch)) continue;
    const latin =
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0xc0 && c <= 0x24f) || // Latin-1 Supplement + Extended-A/B
      (c >= 0x1e00 && c <= 0x1eff); // Latin Extended Additional
    if (!latin) return false;
  }
  return true;
}

/**
 * The one entry out of a single-file zip.
 *
 * Hand-rolled rather than a dependency, because the alternative is adding a zip
 * library to the API for a script that runs once a year. A GeoNames dump is one
 * deflated entry, so this is: find the local header, take its declared sizes,
 * inflate the raw stream after the name and extra fields.
 */
function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip file");
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  // The local header's sizes are zero when the writer streamed the entry, so the
  // end is found from the central directory instead of trusted from here.
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const compressed = buf.subarray(start, cdOffset);
  if (method === 0) return compressed.toString("utf8");
  if (method !== 8) throw new Error(`unsupported compression method ${method}`);
  return inflateRawSync(compressed).toString("utf8");
}

async function get(path: string): Promise<Buffer> {
  process.stdout.write(`  fetching ${path}…`);
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  process.stdout.write(` ${Math.round(buf.length / 1024)} KB\n`);
  return buf;
}

/** Lines of a GeoNames text file, minus its `#` preamble and blank tail. */
function rows(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

interface Place {
  geonameId: number;
  kind: "CITY" | "REGION" | "COUNTRY";
  name: string;
  asciiName: string;
  altNames: string[];
  countryCode: string;
  admin1Code: string;
  latitude: string;
  longitude: string;
  timezone: string;
  population: number;
}

async function main(): Promise<void> {
  console.log("\nRebuilding the place dataset from GeoNames.\n");

  const [citiesZip, admin1Txt, countryTxt] = await Promise.all([
    get("cities5000.zip"),
    get("admin1CodesASCII.txt"),
    get("countryInfo.txt"),
  ]);

  // --- countries -----------------------------------------------------------
  // ISO, ISO3, ISO-numeric, fips, Country, Capital, Area, Population,
  // Continent, tld, CurrencyCode, CurrencyName, Phone, …, geonameid at 16.
  const countries = rows(countryTxt.toString("utf8")).map((f) => ({
    code: f[0]!,
    name: f[4]!,
    currencyCode: f[10] || null,
    population: Number(f[7] ?? 0) || 0,
    geonameId: Number(f[16] ?? 0) || 0,
  }));
  console.log(`\n  ${countries.length} countries`);

  // --- cities --------------------------------------------------------------
  const places: Place[] = [];
  for (const f of rows(unzipSingle(citiesZip))) {
    const altNames: string[] = [];
    const seen = new Set([f[1]!.toLowerCase(), f[2]!.toLowerCase()]);
    for (const raw of (f[3] ?? "").split(",")) {
      const alt = raw.trim();
      if (!alt || alt.length > 60) continue;
      if (seen.has(alt.toLowerCase()) || !isLatin(alt)) continue;
      seen.add(alt.toLowerCase());
      altNames.push(alt);
      if (altNames.length >= 5) break;
    }
    places.push({
      geonameId: Number(f[0]),
      kind: "CITY",
      name: f[1]!,
      asciiName: f[2]!,
      altNames,
      countryCode: f[8]!,
      admin1Code: f[10] ?? "",
      latitude: f[4]!,
      longitude: f[5]!,
      timezone: f[17] ?? "",
      population: Number(f[14] ?? 0) || 0,
    });
  }
  console.log(`  ${places.length} cities`);

  /*
   * A region's and a country's timezone, and its population.
   *
   * Neither file carries either: `admin1CodesASCII` is four columns and
   * `countryInfo` has no zone at all. So both are derived from the cities we
   * already have — the most populous city inside the region (or country) lends
   * its timezone, and the region's population is the sum of its cities'.
   *
   * A heuristic, and deliberately a stated one. "A trip to Portugal" clocked to
   * Lisbon is right far more often than a trip clocked to nothing, and the sum
   * is what makes "Tuscany" outrank a village when both match a query. Where we
   * hold no city for a region, the zone stays empty rather than guessed.
   *
   * No coordinates for either: a country is not a point, and the only thing
   * lat/lon was going to buy is a dot on a map, which a city has and a nation
   * does not.
   */
  const byAdmin1 = new Map<string, Place[]>();
  const byCountry = new Map<string, Place[]>();
  const push = (map: Map<string, Place[]>, key: string, p: Place) => {
    const group = map.get(key);
    if (group) group.push(p);
    else map.set(key, [p]);
  };
  for (const p of places) {
    push(byAdmin1, `${p.countryCode}.${p.admin1Code}`, p);
    push(byCountry, p.countryCode, p);
  }
  const summarise = (group: Place[] | undefined) => {
    if (!group || group.length === 0) return { timezone: "", population: 0 };
    let biggest = group[0]!;
    let population = 0;
    for (const p of group) {
      population += p.population;
      if (p.population > biggest.population) biggest = p;
    }
    return { timezone: biggest.timezone, population };
  };

  // --- regions -------------------------------------------------------------
  // code ("PT.11"), name, ascii name, geonameid.
  let regions = 0;
  for (const f of rows(admin1Txt.toString("utf8"))) {
    const [countryCode, admin1Code] = f[0]!.split(".");
    if (!countryCode || !admin1Code) continue;
    const { timezone, population } = summarise(
      byAdmin1.get(`${countryCode}.${admin1Code}`),
    );
    places.push({
      geonameId: Number(f[3]),
      kind: "REGION",
      name: f[1]!,
      asciiName: f[2]!,
      altNames: [],
      countryCode,
      admin1Code,
      latitude: "",
      longitude: "",
      timezone,
      population,
    });
    regions += 1;
  }
  console.log(`  ${regions} regions`);

  for (const c of countries) {
    if (!c.geonameId) continue;
    const { timezone } = summarise(byCountry.get(c.code));
    places.push({
      geonameId: c.geonameId,
      kind: "COUNTRY",
      name: c.name,
      asciiName: c.name,
      altNames: [],
      countryCode: c.code,
      admin1Code: "",
      latitude: "",
      longitude: "",
      timezone,
      // The real one from `countryInfo`, which is what keeps a country ahead of
      // every city that shares a name with it.
      population: c.population,
    });
  }

  // --- write ---------------------------------------------------------------
  const header =
    "geonameId\tkind\tname\tasciiName\taltNames\tcountryCode\tadmin1Code\tlatitude\tlongitude\ttimezone\tpopulation";
  const body = places.map((p) =>
    [
      p.geonameId,
      p.kind,
      p.name,
      p.asciiName,
      p.altNames.join("|"),
      p.countryCode,
      p.admin1Code,
      p.latitude,
      p.longitude,
      p.timezone,
      p.population,
    ].join("\t"),
  );
  const gz = gzipSync(Buffer.from([header, ...body].join("\n"), "utf8"), {
    level: 9,
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "places.tsv.gz"), gz);
  await writeFile(
    join(OUT_DIR, "countries.tsv"),
    [
      "code\tname\tcurrencyCode",
      ...countries.map((c) =>
        [c.code, c.name, c.currencyCode ?? ""].join("\t"),
      ),
    ].join("\n") + "\n",
    "utf8",
  );

  console.log(
    `\n  ${places.length} places → prisma/data/places.tsv.gz (${Math.round(
      gz.length / 1024,
    )} KB)`,
  );
  console.log(`  ${countries.length} countries → prisma/data/countries.tsv\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
