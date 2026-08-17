import { PrismaClient } from "@prisma/client";
import { DEMO_PASSWORD, seedDemoTrip } from "../src/admin/demo-seed.ts";

/**
 * The demo seed, from a terminal:
 *
 *   pnpm --filter @gtp/api demo:seed
 *
 * Everything it does lives in `src/admin/demo-seed.ts`, because the operator
 * console can run the same thing from a browser and the two must not be able to
 * drift into building different demos. This file is the CLI half: a connection,
 * a call, and the summary printed for whoever ran it.
 *
 * The import carries an explicit `.ts` extension rather than the `.js` the
 * compiled app uses. This script is never compiled — `demo:seed` runs it through
 * node's `--experimental-strip-types`, which resolves the path as written — and
 * `tsconfig.json` includes only `src`, so nothing typechecks this line either
 * way. That is also why the seed itself has to stay decorator-free.
 */

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const s = await seedDemoTrip(prisma);

  if (s.removedTrips > 0) {
    console.log(`Removed ${s.removedTrips} existing demo trip(s).`);
  }
  console.log(
    [
      "",
      "  Demo trip rebuilt.",
      "",
      `    trip      ${s.tripName} (${s.tripId})`,
      `    sign in   ${s.email}`,
      `    password  ${DEMO_PASSWORD}`,
      "",
      `    ${s.members} members · ${s.options} options · ${s.decisions} decisions · ${s.messages} messages`,
      "",
    ].join("\n"),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
