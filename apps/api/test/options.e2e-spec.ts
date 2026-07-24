import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Options integration test (real DB) — the Phase-2.2 DoD:
 *  - a Participant proposes; the proposer or an Organizer edits;
 *  - a Participant cannot edit someone else's option; a Guest cannot propose;
 *  - a material edit stamps materialChangedAt (a cosmetic one doesn't);
 *  - a locked option is rejected; a stale version is a 409;
 *  - a History trip is frozen; delete is soft (row persists, list hides it).
 */
describe("Options (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `opt+${label}+${suffix}@example.com`;
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

  async function firstCategoryId(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return (res.body as { id: string }[])[0]!.id;
  }

  function optionsUrl(tripId: string, categoryId: string) {
    return `/trips/${tripId}/categories/${categoryId}/options`;
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

  it("a Participant proposes; the option lists with a normalised amount", async () => {
    const owner = await makeUser("p-owner");
    const part = await makeUser("p-part", false); // unverified — proposing allowed
    const trip = await createTrip(owner.accessToken, "Propose");
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    const created = await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${part.accessToken}`)
      .send({
        title: "Airbnb in Alfama",
        amount: 480,
        currency: "eur",
        costType: "TOTAL",
        headcount: 4,
        headcountIsFixed: true,
      })
      .expect(201);
    assert.equal(created.body.amount, 480);
    assert.equal(created.body.currency, "EUR"); // upper-cased by the schema
    assert.equal(created.body.status, "PROPOSED");
    assert.equal(created.body.materialChangedAt, null);
    assert.equal(created.body.proposerName, "p-part");

    const list = await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(200);
    assert.equal((list.body as unknown[]).length, 1);
  });

  it("stamps materialChangedAt on a cost edit but not on a cosmetic one", async () => {
    const owner = await makeUser("m-owner");
    const trip = await createTrip(owner.accessToken, "Material");
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    const created = await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Hotel", amount: 100, currency: "EUR" })
      .expect(201);
    const id = created.body.id as string;

    // Cosmetic edit (title only) → no material stamp, version still bumps.
    const cosmetic = await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Nice Hotel", amount: 100, currency: "EUR", version: 0 })
      .expect(200);
    assert.equal(cosmetic.body.materialChangedAt, null);
    assert.equal(cosmetic.body.version, 1);

    // Material edit (amount) → stamp set.
    const material = await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Nice Hotel", amount: 150, currency: "EUR", version: 1 })
      .expect(200);
    assert.notEqual(material.body.materialChangedAt, null);
    assert.equal(material.body.amount, 150);
  });

  it("enforces proposer-or-Organizer edit and rejects a stale version", async () => {
    const owner = await makeUser("e-owner");
    const alice = await makeUser("e-alice");
    const bob = await makeUser("e-bob");
    const trip = await createTrip(owner.accessToken, "Edit Rights");
    const link = await globalLink(owner.accessToken, trip.id, "PARTICIPANT");
    await join(alice.accessToken, link).expect(201);
    await join(bob.accessToken, link).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    const created = await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ title: "Alice's pick", currency: "EUR" })
      .expect(201);
    const id = created.body.id as string;

    // Bob (a peer Participant, not the proposer) cannot edit it.
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${bob.accessToken}`)
      .send({ title: "Bob's edit", currency: "EUR", version: 0 })
      .expect(403);

    // The Organizer (owner) can edit anyone's option.
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Owner tidy-up", currency: "EUR", version: 0 })
      .expect(200);

    // The proposer re-using the now-stale version 0 is a 409.
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .send({ title: "Alice again", currency: "EUR", version: 0 })
      .expect(409);
  });

  it("a Guest cannot propose; a non-member gets a 404", async () => {
    const owner = await makeUser("g-owner");
    const guest = await makeUser("g-guest");
    const stranger = await makeUser("g-stranger");
    const trip = await createTrip(owner.accessToken, "Guarded Options");
    await join(
      guest.accessToken,
      await globalLink(owner.accessToken, trip.id, "GUEST"),
    ).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    // A Guest may read but not propose (option.propose excludes Guest → 403).
    await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${guest.accessToken}`)
      .expect(200);
    await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${guest.accessToken}`)
      .send({ title: "Nope", currency: "EUR" })
      .expect(403);

    // A non-member gets a 404 — existence not leaked.
    await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it("a locked option cannot be edited; delete is soft", async () => {
    const owner = await makeUser("l-owner");
    const trip = await createTrip(owner.accessToken, "Locked + Delete");
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    const created = await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Locked pick", currency: "EUR" })
      .expect(201);
    const id = created.body.id as string;

    // Simulate the Phase-2.4 lock directly, then editing is rejected (409).
    await prisma.option.update({
      where: { id },
      data: { status: "LOCKED" },
    });
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Sneaky edit", currency: "EUR", version: 0 })
      .expect(409);

    // Soft-delete: it leaves the list but the row survives with deletedAt set.
    await http()
      .delete(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
    const list = await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal((list.body as unknown[]).length, 0);
    const row = await prisma.option.findUnique({ where: { id } });
    assert.ok(row?.deletedAt, "the row persists with deletedAt set");
  });

  it("freezes a History trip", async () => {
    const owner = await makeUser("h-owner");
    const trip = await createTrip(owner.accessToken, "Frozen");
    const cat = await firstCategoryId(owner.accessToken, trip.id);
    const created = await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Before freeze", currency: "EUR" })
      .expect(201);
    const id = created.body.id as string;

    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "HISTORY" },
    });

    // Propose / edit / delete are all refused on a frozen trip.
    await http()
      .post(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "After freeze", currency: "EUR" })
      .expect(403);
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Edit frozen", currency: "EUR", version: 0 })
      .expect(403);
    await http()
      .delete(`${optionsUrl(trip.id, cat)}/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);
  });

  async function propose(
    accessToken: string,
    tripId: string,
    categoryId: string,
    title: string,
  ) {
    const res = await http()
      .post(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title, currency: "EUR" })
      .expect(201);
    return res.body.id as string;
  }

  async function listIds(accessToken: string, tripId: string, categoryId: string) {
    const res = await http()
      .get(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return (res.body as { id: string }[]).map((o) => o.id);
  }

  it("proposes append at the end, and an Organizer can reorder them (Phase 3.5)", async () => {
    const owner = await makeUser("ro-owner");
    const trip = await createTrip(owner.accessToken, "Reorder");
    const cat = await firstCategoryId(owner.accessToken, trip.id);

    // Three proposals list in creation order (append-at-end).
    const a = await propose(owner.accessToken, trip.id, cat, "A");
    const b = await propose(owner.accessToken, trip.id, cat, "B");
    const c = await propose(owner.accessToken, trip.id, cat, "C");
    assert.deepEqual(await listIds(owner.accessToken, trip.id, cat), [a, b, c]);

    // Reverse them via a full-set reorder; the new order persists on re-read.
    const reordered = await http()
      .post(`${optionsUrl(trip.id, cat)}/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: [c, b, a] })
      .expect(201);
    assert.deepEqual(
      (reordered.body as { id: string }[]).map((o) => o.id),
      [c, b, a],
    );
    assert.deepEqual(await listIds(owner.accessToken, trip.id, cat), [c, b, a]);

    // A new proposal still appends at the very end of the reordered list.
    const d = await propose(owner.accessToken, trip.id, cat, "D");
    assert.deepEqual(await listIds(owner.accessToken, trip.id, cat), [c, b, a, d]);
  });

  it("rejects a partial reorder (400) and a non-organizer/non-member", async () => {
    const owner = await makeUser("rp-owner");
    const part = await makeUser("rp-part");
    const stranger = await makeUser("rp-stranger");
    const trip = await createTrip(owner.accessToken, "Reorder Guarded");
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);
    const a = await propose(owner.accessToken, trip.id, cat, "A");
    const b = await propose(owner.accessToken, trip.id, cat, "B");

    // A partial list (must be the full set exactly once) → 400.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: [a] })
      .expect(400);

    // A Participant is not an Organizer (category.manage) → 403.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/reorder`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .send({ orderedIds: [b, a] })
      .expect(403);

    // A non-member gets a 404 — existence not leaked.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/reorder`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ orderedIds: [b, a] })
      .expect(404);

    // Order is unchanged after the rejected attempts.
    assert.deepEqual(await listIds(owner.accessToken, trip.id, cat), [a, b]);
  });
});
