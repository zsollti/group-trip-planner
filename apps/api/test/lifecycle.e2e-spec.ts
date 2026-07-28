import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { expiryFromEndDate } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { LifecycleService } from "../src/lifecycle/lifecycle.service.js";

/**
 * Dates write-back + lifecycle integration test (real DB) — the Phase-2.5 DoD
 * and the SRS §10 lifecycle backbone test. Proves:
 *  - locking a valid Dates option writes Trip.start/endDate + expiresAt = end+1mo;
 *  - a past-start or over-horizon Dates lock is rejected (400);
 *  - unlocking the Dates option clears the dates and reverts to the +1yr fallback;
 *  - a trip past expiresAt reads as History and freezes propose/vote/lock, even
 *    before the job runs (defensive read-time check); the job then persists it.
 */
describe("Lifecycle + Dates write-back (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let lifecycle: LifecycleService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());
  const DAY = 24 * 60 * 60 * 1000;

  async function makeUser(label: string) {
    const email = `life+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    return { user, accessToken: await tokens_.signAccessToken(user) };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body as { id: string };
  }

  async function categories(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const byKey: Record<string, { id: string; version: number }> = {};
    for (const c of res.body as {
      id: string;
      version: number;
      builtinKey: string | null;
    }[]) {
      if (c.builtinKey) byKey[c.builtinKey] = { id: c.id, version: c.version };
    }
    return byKey;
  }

  function optionsUrl(tripId: string, categoryId: string) {
    return `/trips/${tripId}/categories/${categoryId}/options`;
  }

  async function proposeDates(
    accessToken: string,
    tripId: string,
    categoryId: string,
    startsAt: string,
    endsAt: string,
  ) {
    const res = await http()
      .post(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Trip week", currency: "EUR", startsAt, endsAt })
      .expect(201);
    return res.body as { id: string; version: number };
  }

  function getTrip(accessToken: string, tripId: string) {
    return http()
      .get(`/trips/${tripId}`)
      .set("Authorization", `Bearer ${accessToken}`);
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: () => Promise.resolve(),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
    lifecycle = app.get(LifecycleService);
  });

  after(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      await prisma.trip.deleteMany({
        where: { ownerId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("locking a Dates option writes trip dates + expiry; unlocking reverts", async () => {
    const owner = await makeUser("dw-owner");
    const trip = await createTrip(owner.accessToken, "Dates write-back");
    const cats = await categories(owner.accessToken, trip.id);
    const dates = cats.DATES!; // single-choice built-in

    const startsAt = new Date(Date.now() + 30 * DAY).toISOString();
    const endsAt = new Date(Date.now() + 37 * DAY).toISOString();
    const opt = await proposeDates(
      owner.accessToken,
      trip.id,
      dates.id,
      startsAt,
      endsAt,
    );

    const beforeExpiry = (await getTrip(owner.accessToken, trip.id)).body
      .expiresAt as string;

    // Lock the Dates option → dates + expiry are written back (FR-8).
    await http()
      .post(`${optionsUrl(trip.id, dates.id)}/${opt.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: opt.version, categoryVersion: dates.version })
      .expect(201);

    const locked = (await getTrip(owner.accessToken, trip.id)).body;
    assert.equal(
      new Date(locked.startDate).toISOString().slice(0, 10),
      startsAt.slice(0, 10),
    );
    assert.equal(
      new Date(locked.endDate).toISOString().slice(0, 10),
      endsAt.slice(0, 10),
    );
    assert.equal(
      locked.expiresAt,
      expiryFromEndDate(Date.parse(endsAt)),
      "expiry is end date + 1 month",
    );

    // Unlock → dates cleared, expiry reverts to the created + 1yr fallback (FR-9).
    const lockedVersion = (
      await http()
        .get(optionsUrl(trip.id, dates.id))
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200)
    ).body[0].version as number;

    await http()
      .post(`${optionsUrl(trip.id, dates.id)}/${opt.id}/unlock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ version: lockedVersion })
      .expect(201);

    const reverted = (await getTrip(owner.accessToken, trip.id)).body;
    assert.equal(reverted.startDate, null);
    assert.equal(reverted.endDate, null);
    // Back to roughly the created + 1yr fallback (differs from the end+1mo expiry).
    assert.notEqual(reverted.expiresAt, expiryFromEndDate(Date.parse(endsAt)));
    assert.ok(
      Math.abs(Date.parse(reverted.expiresAt) - Date.parse(beforeExpiry)) <
        DAY,
      "expiry reverts near the original fallback",
    );
  });

  it("rejects locking a Dates option with past or over-horizon dates (400)", async () => {
    const owner = await makeUser("dr-owner");
    const trip = await createTrip(owner.accessToken, "Bad dates");
    const cats = await categories(owner.accessToken, trip.id);
    const dates = cats.DATES!;

    // Past start.
    const past = await proposeDates(
      owner.accessToken,
      trip.id,
      dates.id,
      new Date(Date.now() - 5 * DAY).toISOString(),
      new Date(Date.now() - 2 * DAY).toISOString(),
    );
    await http()
      .post(`${optionsUrl(trip.id, dates.id)}/${past.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: past.version, categoryVersion: dates.version })
      .expect(400);

    // Over the 1-year horizon.
    const farCats = await categories(owner.accessToken, trip.id);
    const far = await proposeDates(
      owner.accessToken,
      trip.id,
      dates.id,
      new Date(Date.now() + 10 * DAY).toISOString(),
      new Date(Date.now() + 400 * DAY).toISOString(),
    );
    await http()
      .post(`${optionsUrl(trip.id, dates.id)}/${far.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: far.version, categoryVersion: farCats.DATES!.version })
      .expect(400);

    // Neither failed lock wrote trip dates.
    const stillEmpty = (await getTrip(owner.accessToken, trip.id)).body;
    assert.equal(stillEmpty.startDate, null);
  });

  it("a trip past expiresAt is frozen at read time and the job persists History", async () => {
    const owner = await makeUser("ex-owner");
    const trip = await createTrip(owner.accessToken, "Expired");
    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.TRANSPORT!;
    const opt = await http()
      .post(optionsUrl(trip.id, transport.id))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Bus", currency: "EUR" })
      .expect(201);

    // Push expiry into the past — the row is still persisted ACTIVE.
    await prisma.trip.update({
      where: { id: trip.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });

    // Read-time defensive freeze: the detail already reads as History…
    const detail = (await getTrip(owner.accessToken, trip.id)).body;
    assert.equal(detail.status, "HISTORY");

    // …and every planning mutation is refused (propose / vote / lock).
    await http()
      .post(optionsUrl(trip.id, transport.id))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Train", currency: "EUR" })
      .expect(403);
    await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.body.id}/votes`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);
    await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.body.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: opt.body.version, categoryVersion: transport.version })
      .expect(403);

    // The row is still persisted ACTIVE until the job runs…
    const rowBefore = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    assert.equal(rowBefore.status, "ACTIVE");

    // …then the expiry job flips it to History persistently.
    const moved = await lifecycle.expireTrips();
    assert.ok(moved >= 1);
    const rowAfter = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    assert.equal(rowAfter.status, "HISTORY");
  });

  /**
   * The transition backbone (SRS §10) is not only "expired trips move" — it is
   * that **nothing else does**. An over-broad predicate in the hourly job would
   * freeze live trips wholesale, and the test above (`moved >= 1`) would not
   * notice. Phase 7.4.
   */
  it("the expiry job moves only trips whose expiry has passed, and is idempotent", async () => {
    const owner = await makeUser("job-owner");
    const expired = await createTrip(owner.accessToken, "Long over");
    const upcoming = await createTrip(owner.accessToken, "Still planning");

    await prisma.trip.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });
    await prisma.trip.update({
      where: { id: upcoming.id },
      data: { expiresAt: new Date(Date.now() + 30 * DAY) },
    });

    await lifecycle.expireTrips();

    assert.equal(
      (await prisma.trip.findUniqueOrThrow({ where: { id: expired.id } }))
        .status,
      "HISTORY",
    );
    assert.equal(
      (await prisma.trip.findUniqueOrThrow({ where: { id: upcoming.id } }))
        .status,
      "ACTIVE",
      "a trip whose expiry is still ahead must be left alone",
    );

    // Running again re-moves nothing: the job's predicate excludes trips it has
    // already flipped, so an hourly schedule does not rewrite the same rows.
    const before = await prisma.trip.findUniqueOrThrow({
      where: { id: expired.id },
    });
    await lifecycle.expireTrips();
    const after = await prisma.trip.findUniqueOrThrow({
      where: { id: expired.id },
    });
    assert.equal(after.status, "HISTORY");
    assert.deepEqual(
      after.updatedAt,
      before.updatedAt,
      "an already-expired trip is not touched again",
    );
  });
});
