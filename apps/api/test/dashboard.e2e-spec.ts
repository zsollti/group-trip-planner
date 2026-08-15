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
 *  - an opt-in option is priced for the members who joined it, and a member who
 *    leaves the trip stops counting toward it;
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
        .send({
          name: cat.name,
          singleChoice: false,
          paletteKey: null,
          version: cat.version,
        })
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

  /** Say you are in for an option — the replacement for a typed headcount. */
  function joinOption(
    accessToken: string,
    tripId: string,
    categoryId: string,
    optionId: string,
  ) {
    return http()
      .post(`${optionsUrl(tripId, categoryId)}/${optionId}/participation`)
      .set("Authorization", `Bearer ${accessToken}`);
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

  it("prices an opt-in option for the members who said they are in", async () => {
    const owner = await makeUser("oi-owner");
    const joiner = await makeUser("oi-joiner");
    const trip = await createTrip(owner.accessToken, "Opt in");
    const c1 = await multiSelectCategory(owner.accessToken, trip.id);
    const c2 = await multiSelectCategory(owner.accessToken, trip.id, [c1.id]);

    await join(
      joiner.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    // A €400 total only some of the trip wants, plus a whole-group taxi.
    const surf = await propose(owner.accessToken, trip.id, c1.id, {
      title: "Surf lesson",
      amount: 400,
      currency: "EUR",
      costType: "TOTAL",
      participationMode: "OPT_IN",
    });
    const taxi = await propose(owner.accessToken, trip.id, c2.id, {
      title: "Group taxi",
      amount: 60,
      currency: "EUR",
      costType: "TOTAL",
    });
    await lock(
      owner.accessToken,
      trip.id,
      c1.id,
      surf.id,
      surf.version,
      c1.version,
    );
    await lock(
      owner.accessToken,
      trip.id,
      c2.id,
      taxi.id,
      taxi.version,
      c2.version,
    );

    // Nobody has joined it yet, so it is not the group's money.
    const before = await dashboard(owner.accessToken, trip.id);
    assert.equal(before.memberCount, 2);
    const surfBefore = before.lines.find((l) => l.optionId === surf.id)!;
    assert.equal(surfBefore.effectiveHeadcount, 0);
    assert.equal(surfBefore.perPerson, 0);

    // One member is in → priced for one, not for the trip.
    await joinOption(owner.accessToken, trip.id, c1.id, surf.id).expect(201);
    const one = await dashboard(owner.accessToken, trip.id);
    const surfOne = one.lines.find((l) => l.optionId === surf.id)!;
    assert.equal(surfOne.effectiveHeadcount, 1);
    assert.equal(surfOne.perPerson, 400);

    // The other joins → the same €400 now splits two ways, and the whole-group
    // taxi is unaffected by any of it.
    await joinOption(joiner.accessToken, trip.id, c1.id, surf.id).expect(201);
    const two = await dashboard(owner.accessToken, trip.id);
    const surfTwo = two.lines.find((l) => l.optionId === surf.id)!;
    assert.equal(surfTwo.effectiveHeadcount, 2);
    assert.equal(surfTwo.perPerson, 200);
    assert.equal(
      two.lines.find((l) => l.optionId === taxi.id)!.effectiveHeadcount,
      2,
    );
  });

  it("a member who leaves takes their participation with them", async () => {
    // This is the claim the whole model rests on: a headcount cannot fall
    // behind the roster, because it *is* the roster. The FK cascades from the
    // user, not from the membership, so leaving has to clear these rows
    // explicitly — without that a departed person keeps inflating the option
    // they joined, which is exactly the drift the typed number had.
    const owner = await makeUser("lv-owner");
    const leaver = await makeUser("lv-leaver");
    const trip = await createTrip(owner.accessToken, "Leaving");
    const cat = await multiSelectCategory(owner.accessToken, trip.id);

    await join(
      leaver.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    const opt = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Boat trip",
      amount: 300,
      currency: "EUR",
      costType: "TOTAL",
      participationMode: "OPT_IN",
    });
    await lock(
      owner.accessToken,
      trip.id,
      cat.id,
      opt.id,
      opt.version,
      cat.version,
    );
    await joinOption(owner.accessToken, trip.id, cat.id, opt.id).expect(201);
    await joinOption(leaver.accessToken, trip.id, cat.id, opt.id).expect(201);

    const both = await dashboard(owner.accessToken, trip.id);
    assert.equal(
      both.lines.find((l) => l.optionId === opt.id)!.effectiveHeadcount,
      2,
    );

    await http()
      .post(`/trips/${trip.id}/members/leave`)
      .set("Authorization", `Bearer ${leaver.accessToken}`)
      .expect(204);

    const after = await dashboard(owner.accessToken, trip.id);
    assert.equal(after.memberCount, 1);
    const line = after.lines.find((l) => l.optionId === opt.id)!;
    // One person left, so one person is in — and the €300 is theirs alone.
    assert.equal(line.effectiveHeadcount, 1);
    assert.equal(line.perPerson, 300);
  });

  it("refuses to record a joiner on a whole-group option", async () => {
    // Everyone is already in, so a row would be a claim the engine ignores —
    // and a control that appears to work while changing nothing is worse than
    // one that is not offered.
    const owner = await makeUser("wg-owner");
    const trip = await createTrip(owner.accessToken, "Whole group");
    const cat = await multiSelectCategory(owner.accessToken, trip.id);
    const opt = await propose(owner.accessToken, trip.id, cat.id, {
      title: "Group taxi",
      amount: 60,
      currency: "EUR",
      costType: "TOTAL",
    });

    await joinOption(owner.accessToken, trip.id, cat.id, opt.id).expect(400);
    // Leaving one is a no-op rather than an error: withdrawing from something
    // you were never individually signed up for should not fail.
    await http()
      .delete(`${optionsUrl(trip.id, cat.id)}/${opt.id}/participation`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
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
