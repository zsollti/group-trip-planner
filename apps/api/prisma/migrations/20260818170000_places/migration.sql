-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('CITY', 'REGION', 'COUNTRY');

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" CHAR(3),

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "places" (
    "geonameId" INTEGER NOT NULL,
    "kind" "PlaceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "asciiName" TEXT NOT NULL,
    "altNames" TEXT NOT NULL DEFAULT '',
    "countryCode" CHAR(2) NOT NULL,
    "admin1Code" TEXT NOT NULL DEFAULT '',
    "admin1Name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT,
    "population" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "places_pkey" PRIMARY KEY ("geonameId")
);

-- CreateIndex
CREATE INDEX "places_countryCode_idx" ON "places"("countryCode");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: the trip remembers what its destination resolved to.
--
-- All four are nullable and none is a foreign key. `destination` stays free
-- text, so a trip may have a name for its destination and no place behind it;
-- and the places table is a seeded snapshot that gets rebuilt from a newer
-- GeoNames dump, which a constraint would let fail against live trips.
ALTER TABLE "trips" ADD COLUMN "destinationPlaceId" INTEGER;
ALTER TABLE "trips" ADD COLUMN "destinationLat" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "destinationLon" DOUBLE PRECISION;
ALTER TABLE "trips" ADD COLUMN "destinationTimezone" TEXT;

-- The type-ahead's index, which Prisma's schema language cannot express.
--
-- A generated `tsvector` over a folded search string, with a GIN index on it.
-- Three choices worth writing down:
--
--  * **`simple`, not `english`.** A stemming dictionary is for prose. It would
--    have "Reading" (the town) share a lexeme with "read", and would do nothing
--    useful for a Portuguese place name in an English dictionary.
--  * **No extensions.** `unaccent` and `pg_trgm` would both be natural here and
--    both need `CREATE EXTENSION`, which is a privilege this app should not
--    require of whatever Postgres it is pointed at. The accent folding happens
--    in the seeder instead, in JavaScript, and lands in `searchText`.
--  * **Full-text rather than a prefix index.** A `text_pattern_ops` B-tree
--    answers "starts with" and nothing else, so "york" would not find New York.
--    `to_tsquery('york:*')` matches the word, wherever it sits in the name.
ALTER TABLE "places" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "places" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "searchText")) STORED;
CREATE INDEX "places_searchVector_idx" ON "places" USING GIN ("searchVector");
