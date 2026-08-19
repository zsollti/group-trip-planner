import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  DEMO_EMAIL,
  DEMO_HISTORY_TRIP_NAME,
  DEMO_TRIP_NAME,
  seedDemoTrip,
} from "../src/admin/demo-seed.js";

/**
 * The demo seed, against a real database.
 *
 * It had no test at all, and it is the one piece of this codebase whose output a
 * stranger sees first — the board behind the credentials in the README. It also
 * **writes past its own service**: it locks options with `prisma.option.update`
 * rather than through the lock transaction, so nothing but a test like this
 * notices when the shape it writes drifts from the shape the app reads.
 *
 * What is pinned here is what the seed promises rather than its contents: it
 * builds both boards, the second is genuinely ended rather than merely labelled,
 * and running it twice leaves one of each. The last is the whole reason the
 * operator console has a button for it.
 *
 * Real DB, like the other `e2e-spec`s. It owns the demo account's trips by
 * definition — the seed deletes and rebuilds exactly those — so it cannot
 * disturb anything another suite is using.
 */
describe("Demo seed (e2e)", () => {
  const prisma = new PrismaClient();

  before(async () => {
    await prisma.$connect();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("builds a trip that is under way and one that is over", async () => {
    const summary = await seedDemoTrip(prisma);
    assert.equal(summary.tripName, DEMO_TRIP_NAME);
    assert.equal(summary.email, DEMO_EMAIL);

    const owner = await prisma.user.findUnique({
      where: { email: DEMO_EMAIL },
      select: { id: true },
    });
    assert.ok(owner);

    const trips = await prisma.trip.findMany({
      where: { ownerId: owner.id },
      select: { name: true, status: true, expiresAt: true, endDate: true },
    });
    assert.equal(trips.length, 2);

    const active = trips.find((t) => t.name === DEMO_TRIP_NAME);
    const past = trips.find((t) => t.name === DEMO_HISTORY_TRIP_NAME);
    assert.ok(active, "the active demo trip");
    assert.ok(past, "the history demo trip");
    assert.equal(active.status, "ACTIVE");
    assert.equal(past.status, "HISTORY");
  });

  it("dates the ended trip in the past, so its status is not a costume", async () => {
    // `status` is what every list reads, but the lifecycle job derives that
    // status from `expiresAt` — a HISTORY row dated in the future would be a
    // trip the hourly job disagrees with, and the read-time freeze check would
    // let people plan on it.
    await seedDemoTrip(prisma);
    const past = await prisma.trip.findFirstOrThrow({
      where: { name: DEMO_HISTORY_TRIP_NAME },
      select: { expiresAt: true, startDate: true, endDate: true },
    });
    const now = Date.now();
    assert.ok(past.expiresAt.getTime() < now, "expired");
    assert.ok(past.endDate, "has an end date");
    assert.ok(past.endDate.getTime() < now, "ended");
    assert.ok(past.startDate, "has a start date");
    assert.ok(
      past.startDate.getTime() < past.endDate.getTime(),
      "starts before it ends",
    );
  });

  it("leaves every lane of the ended trip decided", async () => {
    // A finished trip with an open vote in it is not finished. The one option
    // deliberately left standing is the date they turned down, which is the
    // road not taken rather than a question still open.
    await seedDemoTrip(prisma);
    const options = await prisma.option.findMany({
      where: { category: { trip: { name: DEMO_HISTORY_TRIP_NAME } } },
      select: { status: true, category: { select: { builtinKey: true } } },
    });
    const decidedLanes = new Set(
      options
        .filter((o) => o.status === "LOCKED")
        .map((o) => o.category.builtinKey),
    );
    assert.equal(decidedLanes.size, 4, "every built-in lane has a decision");
  });

  /**
   * The destination, as a chosen place rather than a typed string.
   *
   * Both halves are here because they are the two states a real environment is
   * in: a database with the gazetteer loaded, and one without. The second is not
   * an edge case — loading places is a separate step somebody runs once, so
   * every brand-new environment is in it, and a seed that only worked after that
   * step would fail precisely where someone is most likely to run it first.
   */
  it("resolves its destinations against the gazetteer, when there is one", async () => {
    const loaded = await prisma.place.count();
    await seedDemoTrip(prisma);
    const trip = await prisma.trip.findFirstOrThrow({
      where: { name: DEMO_TRIP_NAME },
    });

    if (loaded === 0) {
      // Free text is a first-class destination in this product, so this is the
      // old demo rather than a broken one — and the trip still says where it is.
      assert.equal(trip.destination, "Lisbon, Portugal");
      assert.equal(trip.destinationPlaceId, null);
      return;
    }

    // The three facts that separate a chosen place from a typed one, and the
    // reason the seed was worth changing: a demo whose destination carried none
    // of them was quietly showing the product as it was before the picker.
    assert.equal(trip.destinationPlaceId, 2267057, "GeoNames' id for Lisbon");
    assert.equal(trip.destinationTimezone, "Europe/Lisbon");
    assert.ok(trip.destinationLat && trip.destinationLon);
    // …and the label is the picker's own, built by the shared `placeLabel`,
    // rather than a string this seed made up to look like one.
    assert.equal(trip.destination, "Lisbon, Portugal");
  });

  it("is re-runnable, which is what the console's button depends on", async () => {
    // Twice in a row, because a visitor edits the demo and an operator presses
    // the button. A seed that accumulated would leave the account with four
    // boards after two presses.
    await seedDemoTrip(prisma);
    const second = await seedDemoTrip(prisma);
    assert.equal(second.removedTrips, 2, "cleared both of its own boards");

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_EMAIL },
      select: { id: true },
    });
    const count = await prisma.trip.count({ where: { ownerId: owner.id } });
    assert.equal(count, 2);
  });
});
