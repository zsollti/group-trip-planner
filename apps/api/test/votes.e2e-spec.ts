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
 * Approval-voting integration test (real DB) — the Phase-2.3 DoD:
 *  - a member votes for many options in a category (approval style);
 *  - tallies + voter lists are public (any member reads them);
 *  - a material edit flags prior votes stale without deleting them;
 *  - voting is idempotent and toggles off; a Guest cannot vote;
 *  - a History trip freezes voting.
 */
describe("Votes (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `vote+${label}+${suffix}@example.com`;
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

  async function propose(
    accessToken: string,
    tripId: string,
    categoryId: string,
    title: string,
  ) {
    const res = await http()
      .post(optionsUrl(tripId, categoryId))
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title, amount: 100, currency: "EUR" })
      .expect(201);
    return res.body.id as string;
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

  it("approval voting: a member votes for many options; tallies are public", async () => {
    const owner = await makeUser("a-owner");
    const part = await makeUser("a-part");
    const trip = await createTrip(owner.accessToken, "Approval");
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);
    const optA = await propose(owner.accessToken, trip.id, cat, "Option A");
    const optB = await propose(owner.accessToken, trip.id, cat, "Option B");

    // The Participant votes for BOTH options (approval-style).
    const afterA = await http()
      .post(`${optionsUrl(trip.id, cat)}/${optA}/votes`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(201);
    assert.equal(afterA.body.voteCount, 1);
    assert.equal(afterA.body.viewerHasVoted, true);
    assert.equal(afterA.body.voters[0].displayName, "a-part");
    assert.equal(afterA.body.voters[0].stale, false);

    await http()
      .post(`${optionsUrl(trip.id, cat)}/${optB}/votes`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(201);

    // The owner also votes for A → tally is public and now shows two voters.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/${optA}/votes`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);

    // Any member reads the public tally + voter list.
    const list = await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(200);
    const a = (list.body as { id: string; voteCount: number }[]).find(
      (o) => o.id === optA,
    )!;
    const b = (list.body as { id: string; voteCount: number }[]).find(
      (o) => o.id === optB,
    )!;
    assert.equal(a.voteCount, 2);
    assert.equal(b.voteCount, 1);

    // Idempotent re-vote is a no-op; the toggle-off removes it.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/${optA}/votes`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(201);
    const afterUnvote = await http()
      .delete(`${optionsUrl(trip.id, cat)}/${optA}/votes`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(200);
    assert.equal(afterUnvote.body.viewerHasVoted, false);
    assert.equal(afterUnvote.body.voteCount, 1); // only the owner's vote remains
  });

  it("a material edit flags prior votes stale without deleting them (FR-23)", async () => {
    const owner = await makeUser("s-owner");
    const trip = await createTrip(owner.accessToken, "Stale");
    const cat = await firstCategoryId(owner.accessToken, trip.id);
    const opt = await propose(owner.accessToken, trip.id, cat, "Priced pick");

    await http()
      .post(`${optionsUrl(trip.id, cat)}/${opt}/votes`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);

    // Ensure the material edit lands strictly after the vote timestamp.
    await new Promise((r) => setTimeout(r, 10));

    // A material (amount) edit stamps materialChangedAt → the prior vote is stale.
    await http()
      .patch(`${optionsUrl(trip.id, cat)}/${opt}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Priced pick", amount: 250, currency: "EUR", version: 0 })
      .expect(200);

    const list = await http()
      .get(optionsUrl(trip.id, cat))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const row = (
      list.body as { id: string; voteCount: number; voters: { stale: boolean }[] }[]
    ).find((o) => o.id === opt)!;
    assert.equal(row.voteCount, 1); // the vote survives (not reset)
    assert.equal(row.voters[0]!.stale, true); // but it is flagged stale
  });

  it("a Guest cannot vote; freezing the trip stops voting", async () => {
    const owner = await makeUser("g-owner");
    const guest = await makeUser("g-guest");
    const trip = await createTrip(owner.accessToken, "Guarded Voting");
    await join(
      guest.accessToken,
      await globalLink(owner.accessToken, trip.id, "GUEST"),
    ).expect(201);
    const cat = await firstCategoryId(owner.accessToken, trip.id);
    const opt = await propose(owner.accessToken, trip.id, cat, "Pick");

    // A Guest holds trip.view (can read the tally) but not vote.cast → 403.
    await http()
      .post(`${optionsUrl(trip.id, cat)}/${opt}/votes`)
      .set("Authorization", `Bearer ${guest.accessToken}`)
      .expect(403);

    // Voting is refused once the trip is frozen (History).
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "HISTORY" },
    });
    await http()
      .post(`${optionsUrl(trip.id, cat)}/${opt}/votes`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);
  });
});
