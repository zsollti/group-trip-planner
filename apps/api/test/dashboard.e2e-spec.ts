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

  it("charges an opt-in option only to the members who joined it", async () => {
    /**
     * The reported bug, end to end. A €100 target, €98 of shared options and a
     * €4 thing two of five joined: the trip's per-person total adds every
     * option's per-head cost, so it read €102 for everyone and warned the three
     * who had declined to spend the €4.
     *
     * `viewerCommitted` is the fix, and it is per caller — so the same request
     * to the same URL answers differently for two members, which is the whole
     * point and the thing worth pinning.
     */
    const owner = await makeUser("vs-owner");
    const other = await makeUser("vs-other");
    const trip = await createTrip(owner.accessToken, "Viewer share");
    const c1 = await multiSelectCategory(owner.accessToken, trip.id);
    const c2 = await multiSelectCategory(owner.accessToken, trip.id, [c1.id]);

    await join(
      other.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    const shared = await propose(owner.accessToken, trip.id, c1.id, {
      title: "Shared",
      amount: 98,
      currency: "EUR",
      costType: "PER_PERSON",
    });
    const extra = await propose(owner.accessToken, trip.id, c2.id, {
      title: "Only some of us",
      amount: 4,
      currency: "EUR",
      costType: "PER_PERSON",
      participationMode: "OPT_IN",
    });
    await lock(
      owner.accessToken,
      trip.id,
      c1.id,
      shared.id,
      shared.version,
      c1.version,
    );
    await lock(
      owner.accessToken,
      trip.id,
      c2.id,
      extra.id,
      extra.version,
      c2.version,
    );
    await joinOption(owner.accessToken, trip.id, c2.id, extra.id).expect(201);

    const mine = await dashboard(owner.accessToken, trip.id);
    const theirs = await dashboard(other.accessToken, trip.id);

    // The trip's own total is the same for both, and still adds everything.
    assert.equal(sub(mine.committed, "EUR")?.perPerson, 102);
    assert.equal(sub(theirs.committed, "EUR")?.perPerson, 102);

    // The share is not: the joiner owes 102, the member who declined owes 98.
    assert.equal(sub(mine.viewerCommitted, "EUR")?.perPerson, 102);
    assert.equal(sub(theirs.viewerCommitted, "EUR")?.perPerson, 98);

    // And each line says whose money it is.
    const line = (d: TripDashboardView, id: string) =>
      d.lines.find((l) => l.optionId === id)!;
    assert.equal(line(mine, extra.id).viewerOwes, true);
    assert.equal(line(theirs, extra.id).viewerOwes, false);
    // The shared one is everyone's, however they answered the other.
    assert.equal(line(theirs, shared.id).viewerOwes, true);

    // …and names **who**, so the cost surface can draw them rather than say
    // "for 1 member". The same list reaches both readers: who is in is a fact
    // about the option, not about who is asking — only `viewerOwes` is the
    // reader's own answer.
    //
    // Note what these two assertions together rule out. `viewerOwes` used to be
    // computed from this list being non-empty, which worked only because the
    // query was filtered to the caller. Widening it to carry names would have
    // made the option look like everyone's the moment one person joined, and
    // charged the member who declined for it.
    assert.deepEqual(
      line(mine, extra.id).participants.map((p) => p.displayName),
      [owner.user.displayName],
    );
    assert.deepEqual(
      line(theirs, extra.id).participants.map((p) => p.displayName),
      [owner.user.displayName],
    );
    // A whole-group option names nobody: it would be the entire roster,
    // restated on every line.
    assert.deepEqual(line(mine, shared.id).participants, []);
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

  it("keeps one member's private spend out of every shared figure", async () => {
    /**
     * The separation the whole feature rests on, checked from the outside.
     *
     * Two members of one trip ask the same URL. One of them has a flight home
     * on their own list; the other must not learn that from any field of the
     * answer — not the totals, not the lines, not the converted figures — and
     * the trip's own `committed` must be the same number for both, because it
     * is a claim about what the *group* agreed to spend.
     */
    const owner = await makeUser("pi-owner");
    const other = await makeUser("pi-other");
    const trip = await createTrip(owner.accessToken, "Private spend");
    const c1 = await multiSelectCategory(owner.accessToken, trip.id);

    await join(
      other.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    const shared = await propose(owner.accessToken, trip.id, c1.id, {
      title: "Shared",
      amount: 100,
      currency: "EUR",
      costType: "PER_PERSON",
    });
    await lock(
      owner.accessToken,
      trip.id,
      c1.id,
      shared.id,
      shared.version,
      c1.version,
    );

    await http()
      .post(`/trips/${trip.id}/personal-items`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Flight home", amount: 210, currency: "EUR" })
      .expect(201);

    const mine = await dashboard(owner.accessToken, trip.id);
    const theirs = await dashboard(other.accessToken, trip.id);

    // The owner sees their own money, once, in the field made for it.
    assert.equal(sub(mine.viewerPersonal, "EUR")?.group, 210);
    assert.equal(mine.personalLines.length, 1);
    assert.equal(mine.personalLines[0]?.title, "Flight home");

    // The other member sees none of it, anywhere.
    assert.deepEqual(theirs.viewerPersonal, []);
    assert.deepEqual(theirs.personalLines, []);
    assert.ok(
      !JSON.stringify(theirs).includes("Flight home"),
      "no trace of another member's private item in the payload",
    );

    // And the group's own total is the same claim for both of them.
    assert.equal(sub(mine.committed, "EUR")?.group, 200);
    assert.equal(
      sub(theirs.committed, "EUR")?.group,
      sub(mine.committed, "EUR")?.group,
    );
    assert.equal(
      sub(mine.viewerCommitted, "EUR")?.perPerson,
      100,
      "a personal item never reaches the figure the target is read against",
    );
  });

  it("drops an unpriced personal item rather than costing it at zero", async () => {
    /**
     * The same rule the cost engine follows for options, and for the same
     * reason: a currency named in a subtotal is a claim that money is
     * committed in it. An item somebody noted without a price has committed
     * none, and zeroing it would put the trip's currency in a subtotal of
     * nothing — the shape of the phantom EUR total that reached the board once
     * before.
     */
    const owner = await makeUser("pi-unpriced");
    const trip = await createTrip(owner.accessToken, "Unpriced");

    await http()
      .post(`/trips/${trip.id}/personal-items`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Look into a visa", currency: "EUR" })
      .expect(201);

    const d = await dashboard(owner.accessToken, trip.id);
    assert.deepEqual(d.viewerPersonal, [], "no subtotal of nothing");
    assert.deepEqual(d.personalLines, [], "and no line to draw");
  });

  it("carries a personal item's lane tag so a chart can colour it", async () => {
    const owner = await makeUser("pi-tag");
    const trip = await createTrip(owner.accessToken, "Tagged");
    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.find((c) => c.builtinKey === "TRANSPORT")!;

    await http()
      .post(`/trips/${trip.id}/personal-items`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Flight out",
        amount: 180,
        currency: "EUR",
        categoryId: transport.id,
      })
      .expect(201);

    const d = await dashboard(owner.accessToken, trip.id);
    const l = d.personalLines[0]!;
    assert.equal(l.categoryId, transport.id);
    assert.equal(
      l.categoryName,
      transport.name,
      "the name rides along, so a chart needs no second lookup",
    );
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
