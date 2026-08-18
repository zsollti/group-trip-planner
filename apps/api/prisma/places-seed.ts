/**
 * Load the gazetteer into this database.
 *
 *   pnpm --filter @gtp/api places:seed
 *
 * The logic is in `src/places/places-seed.ts`; this owns the connection and the
 * printing, exactly as `prisma/demo-seed.ts` does. Run it once per environment
 * after the migration, and again whenever `places:fetch` has produced a newer
 * dataset. It is idempotent.
 *
 * Data © GeoNames, CC BY 4.0.
 */

import { PrismaClient } from "@prisma/client";
import { seedPlaces } from "../src/places/places-seed.ts";

const prisma = new PrismaClient();

try {
  console.log("\nLoading places…");
  const s = await seedPlaces(prisma);
  const cities = s.places - s.regions - s.nations;
  console.log(`\n  ${s.countries} countries`);
  console.log(
    `  ${s.places} places — ${cities} cities, ${s.regions} regions, ${s.nations} countries\n`,
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
