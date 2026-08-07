import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { CategoryView, TripDashboardView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Per-trip cost dashboard integration test (real DB) — the Phase-3.2 DoD:
 *  - the endpoint's figures match the pure cost engine (committed vs. projected,
 *    per-currency group + per-person, never summed across currencies);
 *  - the front-runner of an open category shows up in the projection only;
 *  - a fixed-headcount option's stale flag flips after a member joins, while a
 *    dynamic-headcount option never goes stale;
 *  - authorization: a non-member gets 404, and a Guest may read the dashboard.
 */
describe("Trip dashboard (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `dash+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: verified,
        passwordHash: "x",
      },
    });
    const accessToken = await tokens_.signAccessToken(user);
    return { user, accessToken, email };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body as { id: string };
  }

  async function globalLink(ownerToken: string, tripId: string, role: string) {
    const res = await http()
      .post(`/trips/${tripId}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ type: "GLOBAL", role })
      .expect(201);
    return res.body.token as string;
  }

  function join(accessToken: string, token: string) {
    return http()
      .post(`/join/${token}`)
      .set("Authorization", `Bearer ${accessToken}`);
  }

  async function categories(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body as CategoryView[];
  }

  /**
   * A multi-select built-in category (locking there guards on the option).
   *
   * Every built-in now **seeds** single-choice — multi-select became a per-trip
   * choice rather than a per-category guess — so this widens one, which is the
   * same route a real organizer takes. `skip` lets a caller ask for a second
   * distinct category.
   */
  async function multiSelectCategory(
    accessToken: string,
    tripId: string,
    skip: string[] = [],
  ) {
    const cats = await categories(accessToken, tripId);
    const cat = cats.find(
      (c) => c.builtinKey !== "DATES" && !skip.includes(c.id),
    );
    assert.ok(cat, "expected a widenable built-in category");
    if (cat.singleChoice) {
      const res = await http()
        .patch(`/trips/${tripId}/categories/${cat.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: cat.name, singleChoice: false, version: cat.version })
        .expect(200);
      return res.body as CategoryView;
    }
    return cat;
  }

  function optionsUrl(tripId: string, categoryId: string) {
    return `/trips/${tripId}/categories/${categoryId}/options`;
  }

  async function propose(
    accessToken: string,
    tripId: string,
    categoryId: string,
    body: Record<string, unknown>,
  ) {
    const res = await http()
      .post(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body)
      .expect(201);
    return res.body as { id: string; version: number };
  }

  function vote(
    accessToken: string,
    tripId: string,
    categoryId: string,
    optionId: string,
  ) {
    return http()
      .post(`${optionsUrl(tripId, categoryId)}/${optionId}/votes`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(201);
  }

  async function lock(
    accessToken: string,
    tripId: string,
    categoryId: string,
    optionId: string,
    optionVersion: number,
    categoryVersion: number,
  ) {
    await http()
      .post(`${optionsUrl(tripId, categoryId)}/${optionId}/lock`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ optionVersion, categoryVersion })
      .expect(201);
  }

  async function dashboard(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/dashboard`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body as TripDashboardView;
  }

  const sub = (subs: TripDashboardView["committed"], currency: string) =>
    subs.find((s) => s.currency === currency);

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

  it("committed = locked; projection adds the open category's front-runner", async () => {
    const owner = await makeUser("f-owner");
    const trip = await createTrip(owner.accessToken, "Figures");
    const cat = await multiSelectCategory(owner.accessToken, trip.id);

    // Two dynamic PER_PERSON options (live count = 1 = just the owner).
    const locked = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Flight",
      amount: 100,
      currency: "EUR",
      costType: "PER_PERSON",
    });
    const runner = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Train",
      amount: 40,
      currency: "EUR",
      costType: "PER_PERSON",
    });
    const alsoRan = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Bus",
      amount: 20,
      currency: "EUR",
      costType: "PER_PERSON",
    });

    // The runner outvotes the also-ran → it is the category front-runner. But the
    // category has a locked option below, so no front-runner is added there...
    await vote(owner.accessToken, trip.id, cat.id, runner.id);

    // Lock "Flight" in this (multi-select) category. Committed = 100 (×1 head).
    await lock(
      owner.accessToken,
      trip.id,
      cat.id,
      locked.id,
      locked.version,
      cat.version,
    );

    const d = await dashboard(owner.accessToken, trip.id);
    assert.equal(d.memberCount, 1);

    // A locked option means the category is decided → NO front-runner is added,
    // so committed and projected are identical here.
    assert.deepEqual(sub(d.committed, "EUR"), {
      currency: "EUR",
      group: 100,
      perPerson: 100,
    });
    assert.deepEqual(sub(d.projected, "EUR"), {
      currency: "EUR",
      group: 100,
      perPerson: 100,
    });

    // The breakdown carries exactly the one locked line.
    const lockedLines = d.lines.filter((l) => l.kind === "LOCKED");
    assert.equal(lockedLines.length, 1);
    assert.equal(lockedLines[0]!.title, "Flight");
    assert.equal(
      d.lines.some((l) => l.kind === "FRONT_RUNNER"),
      false,
    );
    // Unused proposals still exist but never appear as committed/front-runner.
    assert.equal(
      d.lines.some((l) => l.optionId === alsoRan.id),
      false,
    );
  });

  it("an open category contributes its top-voted proposal to the projection only", async () => {
    const owner = await makeUser("p-owner");
    const trip = await createTrip(owner.accessToken, "Projection");
    const cat = await multiSelectCategory(owner.accessToken, trip.id);

    const hi = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Nice hotel",
      amount: 500,
      currency: "EUR",
      costType: "TOTAL",
    });
    await propose(owner.accessToken, trip.id, cat.id, {
      title: "Hostel",
      amount: 120,
      currency: "EUR",
      costType: "TOTAL",
    });
    await vote(owner.accessToken, trip.id, cat.id, hi.id); // front-runner

    const d = await dashboard(owner.accessToken, trip.id);
    // Nothing locked → committed empty; projection = the front-runner (TOTAL 500).
    assert.equal(sub(d.committed, "EUR"), undefined);
    assert.deepEqual(sub(d.projected, "EUR"), {
      currency: "EUR",
      group: 500,
      perPerson: 500,
    });
    const fr = d.lines.filter((l) => l.kind === "FRONT_RUNNER");
    assert.equal(fr.length, 1);
    assert.equal(fr[0]!.title, "Nice hotel");
  });

  it("keeps currencies separate and never sums across them (FR-27)", async () => {
    const owner = await makeUser("m-owner");
    const trip = await createTrip(owner.accessToken, "Multi-currency");
    const c1 = await multiSelectCategory(owner.accessToken, trip.id);
    const c2 = await multiSelectCategory(owner.accessToken, trip.id, [c1.id]);

    const eur = await propose(owner.accessToken, trip.id, c1.id, {
      title: "EUR total",
      amount: 300,
      currency: "EUR",
      costType: "TOTAL",
    });
    const huf = await propose(owner.accessToken, trip.id, c2.id, {
      title: "HUF total",
      amount: 90000,
      currency: "HUF",
      costType: "TOTAL",
    });
    await lock(
      owner.accessToken,
      trip.id,
      c1.id,
      eur.id,
      eur.version,
      c1.version,
    );
    await lock(
      owner.accessToken,
      trip.id,
      c2.id,
      huf.id,
      huf.version,
      c2.version,
    );

    const d = await dashboard(owner.accessToken, trip.id);
    assert.deepEqual(sub(d.committed, "EUR"), {
      currency: "EUR",
      group: 300,
      perPerson: 300,
    });
    assert.deepEqual(sub(d.committed, "HUF"), {
      currency: "HUF",
      group: 90000,
      perPerson: 90000,
    });
    assert.equal(d.committed.length, 2); // two separate subtotals, not one sum
  });

  it("a fixed headcount goes stale after a member joins; dynamic never does", async () => {
    const owner = await makeUser("st-owner");
    const joiner = await makeUser("st-joiner");
    const trip = await createTrip(owner.accessToken, "Stale headcount");
    const c1 = await multiSelectCategory(owner.accessToken, trip.id);
    const c2 = await multiSelectCategory(owner.accessToken, trip.id, [c1.id]);

    // A FIXED-headcount TOTAL option (confirmed now, at 2 heads) + a DYNAMIC one.
    const fixed = await propose(owner.accessToken, trip.id, c1.id, {
      title: "Villa",
      amount: 400,
      currency: "EUR",
      costType: "TOTAL",
      headcount: 2,
      headcountIsFixed: true,
    });
    const dynamic = await propose(owner.accessToken, trip.id, c2.id, {
      title: "Group taxi",
      amount: 60,
      currency: "EUR",
      costType: "TOTAL",
    });
    await lock(
      owner.accessToken,
      trip.id,
      c1.id,
      fixed.id,
      fixed.version,
      c1.version,
    );
    await lock(
      owner.accessToken,
      trip.id,
      c2.id,
      dynamic.id,
      dynamic.version,
      c2.version,
    );

    // Before any membership change, nothing is stale.
    const before = await dashboard(owner.accessToken, trip.id);
    assert.equal(before.hasStaleHeadcount, false);
    assert.equal(before.memberCount, 1);

    // A new member joins → the fixed headcount (2, confirmed earlier) is now stale;
    // the dynamic option simply re-prices against the new live count (still fresh).
    await join(
      joiner.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    const after = await dashboard(owner.accessToken, trip.id);
    assert.equal(after.memberCount, 2);
    assert.equal(after.hasStaleHeadcount, true);
    const fixedLine = after.lines.find((l) => l.optionId === fixed.id)!;
    const dynLine = after.lines.find((l) => l.optionId === dynamic.id)!;
    assert.equal(fixedLine.headcountStale, true);
    assert.equal(fixedLine.effectiveHeadcount, 2); // fixed, not recalculated
    assert.equal(dynLine.headcountStale, false);
    assert.equal(dynLine.effectiveHeadcount, 2); // dynamic follows the live count
  });

  it("re-entering a fixed headcount clears the stale flag", async () => {
    const owner = await makeUser("rc-owner");
    const joiner = await makeUser("rc-joiner");
    const trip = await createTrip(owner.accessToken, "Re-confirm");
    const cat = await multiSelectCategory(owner.accessToken, trip.id);

    // A fixed-headcount proposal that becomes its category's front-runner (voted),
    // so it feeds the projection and can flip the trip-level stale warning.
    const opt = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Cabin",
      amount: 300,
      currency: "EUR",
      costType: "TOTAL",
      headcount: 2,
      headcountIsFixed: true,
    });
    await vote(owner.accessToken, trip.id, cat.id, opt.id);

    await join(
      joiner.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    assert.equal(
      (await dashboard(owner.accessToken, trip.id)).hasStaleHeadcount,
      true,
    );

    // Editing the fixed headcount re-confirms it against the current roster.
    await http()
      .patch(`${optionsUrl(trip.id, cat.id)}/${opt.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Cabin",
        amount: 300,
        currency: "EUR",
        costType: "TOTAL",
        headcount: 3,
        headcountIsFixed: true,
        version: 0,
      })
      .expect(200);

    const after = await dashboard(owner.accessToken, trip.id);
    assert.equal(after.hasStaleHeadcount, false);
    const line = after.lines.find((l) => l.optionId === opt.id)!;
    assert.equal(line.headcountStale, false);
    assert.equal(line.effectiveHeadcount, 3);
  });

  it("a non-member gets 404; a Guest may read the dashboard", async () => {
    const owner = await makeUser("az-owner");
    const guest = await makeUser("az-guest");
    const outsider = await makeUser("az-outsider");
    const trip = await createTrip(owner.accessToken, "Guarded dashboard");
    await join(
      guest.accessToken,
      await globalLink(owner.accessToken, trip.id, "GUEST"),
    ).expect(201);

    // Outsider: existence not leaked → 404 (not 403).
    await http()
      .get(`/trips/${trip.id}/dashboard`)
      .set("Authorization", `Bearer ${outsider.accessToken}`)
      .expect(404);

    // Guest holds trip.view → may see the cost picture.
    await http()
      .get(`/trips/${trip.id}/dashboard`)
      .set("Authorization", `Bearer ${guest.accessToken}`)
      .expect(200);
  });
});
