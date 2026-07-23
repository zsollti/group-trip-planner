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
 * Membership-management integration test (real DB) — the Phase-1.4 DoD:
 *  - a Co-organizer cannot act on the Owner or a peer Co-organizer;
 *  - a block survives a rejoin attempt via a live global link;
 *  - the member cap is enforced through the policy layer;
 *  - Owner-leave is blocked until they transfer/delete;
 *  - kick is soft (rejoin via a live link), transfer moves ownership.
 */
describe("Members (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `member+${label}+${suffix}@example.com`;
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

  /** Mint a GLOBAL link for a role and return its token. */
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

  it("a Co-organizer cannot act on the Owner or a peer Co-organizer", async () => {
    const owner = await makeUser("co-owner");
    const coA = await makeUser("co-a");
    const coB = await makeUser("co-b");
    const trip = await createTrip(owner.accessToken, "Coup Guard");

    const coorgToken = await globalLink(
      owner.accessToken,
      trip.id,
      "CO_ORGANIZER",
    );
    await join(coA.accessToken, coorgToken).expect(201);
    await join(coB.accessToken, coorgToken).expect(201);

    // Co-org A cannot change the Owner's role (strictly-lower: 403).
    await http()
      .patch(`/trips/${trip.id}/members/${owner.user.id}`)
      .set("Authorization", `Bearer ${coA.accessToken}`)
      .send({ role: "GUEST" })
      .expect(403);
    // …nor kick the Owner…
    await http()
      .delete(`/trips/${trip.id}/members/${owner.user.id}`)
      .set("Authorization", `Bearer ${coA.accessToken}`)
      .expect(403);
    // …nor act on a peer Co-organizer…
    await http()
      .patch(`/trips/${trip.id}/members/${coB.user.id}`)
      .set("Authorization", `Bearer ${coA.accessToken}`)
      .send({ role: "GUEST" })
      .expect(403);
    await http()
      .post(`/trips/${trip.id}/members/${coB.user.id}/block`)
      .set("Authorization", `Bearer ${coA.accessToken}`)
      .expect(403);

    // The Owner IS still owner and both co-orgs remain co-orgs.
    const list = await http()
      .get(`/trips/${trip.id}/members`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const roles = Object.fromEntries(
      (list.body.members as { userId: string; role: string }[]).map((m) => [
        m.userId,
        m.role,
      ]),
    );
    assert.equal(roles[owner.user.id], "OWNER");
    assert.equal(roles[coA.user.id], "CO_ORGANIZER");
    assert.equal(roles[coB.user.id], "CO_ORGANIZER");
  });

  it("a Co-organizer CAN manage a Participant (change role, kick)", async () => {
    const owner = await makeUser("mg-owner");
    const coorg = await makeUser("mg-coorg");
    const part = await makeUser("mg-part");
    const trip = await createTrip(owner.accessToken, "Manage Lower");

    await join(
      coorg.accessToken,
      await globalLink(owner.accessToken, trip.id, "CO_ORGANIZER"),
    ).expect(201);
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    // Co-org demotes the Participant to Guest.
    const changed = await http()
      .patch(`/trips/${trip.id}/members/${part.user.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({ role: "GUEST" })
      .expect(200);
    assert.equal(changed.body.role, "GUEST");

    // A Co-organizer cannot promote anyone to a peer Co-organizer.
    await http()
      .patch(`/trips/${trip.id}/members/${part.user.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({ role: "CO_ORGANIZER" })
      .expect(403);

    // …but can kick them (soft).
    await http()
      .delete(`/trips/${trip.id}/members/${part.user.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .expect(204);
    const count = await prisma.tripMembership.count({
      where: { tripId: trip.id, userId: part.user.id },
    });
    assert.equal(count, 0, "kick removes the membership");
  });

  it("a kicked member may rejoin via a live global link (soft removal)", async () => {
    const owner = await makeUser("k-owner");
    const member = await makeUser("k-member");
    const trip = await createTrip(owner.accessToken, "Soft Kick");
    const token = await globalLink(owner.accessToken, trip.id, "PARTICIPANT");

    await join(member.accessToken, token).expect(201);
    await http()
      .delete(`/trips/${trip.id}/members/${member.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);

    // The same live link lets them back in.
    const rejoined = await join(member.accessToken, token).expect(201);
    assert.equal(rejoined.body.role, "PARTICIPANT");
    assert.equal(rejoined.body.alreadyMember, false);
  });

  it("a block survives a rejoin attempt via a live link", async () => {
    const owner = await makeUser("b-owner");
    const member = await makeUser("b-member");
    const trip = await createTrip(owner.accessToken, "Hard Block");
    const token = await globalLink(owner.accessToken, trip.id, "PARTICIPANT");

    await join(member.accessToken, token).expect(201);

    // Owner blocks them: ejected + barred.
    await http()
      .post(`/trips/${trip.id}/members/${member.user.id}/block`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
    const membershipCount = await prisma.tripMembership.count({
      where: { tripId: trip.id, userId: member.user.id },
    });
    assert.equal(membershipCount, 0, "block ejects the membership");

    // The live link no longer lets them in (403 — the bar survives).
    await join(member.accessToken, token).expect(403);

    // The block shows in the management list.
    const list = await http()
      .get(`/trips/${trip.id}/members`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.ok(
      (list.body.blocked as { userId: string }[]).some(
        (b) => b.userId === member.user.id,
      ),
      "the blocked user is listed",
    );

    // After unblock, the same live link works again.
    await http()
      .delete(`/trips/${trip.id}/members/${member.user.id}/block`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
    await join(member.accessToken, token).expect(201);
  });

  it("enforces the member cap through the policy layer", async () => {
    const owner = await makeUser("cap-owner");
    const trip = await createTrip(owner.accessToken, "Cap Enforced");
    const token = await globalLink(owner.accessToken, trip.id, "PARTICIPANT");

    // Shrink the effective cap by pre-filling with direct memberships up to 30
    // (owner already counts as 1 → add 29 to reach the default cap).
    const fillerIds: string[] = [];
    for (let i = 0; i < 29; i++) {
      const u = await prisma.user.create({
        data: {
          email: `filler+${i}+${suffix}@example.com`,
          displayName: `filler-${i}`,
          emailVerified: true,
          passwordHash: "x",
        },
      });
      emails.push(u.email);
      fillerIds.push(u.id);
      await prisma.tripMembership.create({
        data: { tripId: trip.id, userId: u.id, role: "PARTICIPANT" },
      });
    }
    const total = await prisma.tripMembership.count({
      where: { tripId: trip.id },
    });
    assert.equal(total, 30, "trip is now at the default cap");

    // The 31st join is refused by the policy-layer cap.
    const late = await makeUser("cap-late");
    await join(late.accessToken, token).expect(403);
  });

  it("Owner-leave is blocked until ownership is transferred", async () => {
    const owner = await makeUser("t-owner");
    const heir = await makeUser("t-heir");
    const trip = await createTrip(owner.accessToken, "Succession");
    await join(
      heir.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    // The Owner cannot leave (matrix excludes OWNER from trip.leave → 403).
    await http()
      .post(`/trips/${trip.id}/members/leave`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(403);

    // Transfer ownership to the heir.
    await http()
      .post(`/trips/${trip.id}/members/transfer`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ userId: heir.user.id })
      .expect(204);

    // The heir is now OWNER; the old owner is demoted to Co-organizer.
    const detail = await http()
      .get(`/trips/${trip.id}`)
      .set("Authorization", `Bearer ${heir.accessToken}`)
      .expect(200);
    assert.equal(detail.body.role, "OWNER");
    const oldOwnerView = await http()
      .get(`/trips/${trip.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(oldOwnerView.body.role, "CO_ORGANIZER");

    // The now-demoted former owner CAN leave.
    await http()
      .post(`/trips/${trip.id}/members/leave`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
  });

  it("a Participant cannot manage members; a non-member gets a 404", async () => {
    const owner = await makeUser("z-owner");
    const part = await makeUser("z-part");
    const stranger = await makeUser("z-stranger");
    const trip = await createTrip(owner.accessToken, "Guarded");
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    // A Participant is a member but lacks member.manage → 403 on mutations,
    // yet may read the member list (trip.view).
    await http()
      .get(`/trips/${trip.id}/members`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(200);
    await http()
      .delete(`/trips/${trip.id}/members/${owner.user.id}`)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .expect(403);

    // A non-member cannot even see the list — 404 (existence not leaked).
    await http()
      .get(`/trips/${trip.id}/members`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(404);
  });
});
