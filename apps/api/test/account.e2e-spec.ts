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
 * Account-deletion integration test (real DB) — the Phase-1.5 DoD and one of the
 * SRS §10 backbone tests:
 *  - ownership auto-transfers correctly (Co-organizer priority → Participant
 *    fallback → delete-if-solo);
 *  - the departing owner is removed from every trip;
 *  - personal data is purged and the row anonymized (irreversibly);
 *  - every session (refresh token + access token) is revoked.
 */
describe("Account deletion (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `del+${label}+${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: verified,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
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

  function deleteAccount(accessToken: string) {
    return http()
      .delete("/account")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ confirm: true });
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
      // Anonymization rewrites emails, so clean up by the ids we captured.
      await prisma.trip.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it("requires an explicit confirm:true", async () => {
    const u = await makeUser("confirm");
    await http()
      .delete("/account")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({})
      .expect(400);
    await http()
      .delete("/account")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ confirm: false })
      .expect(400);
    // The account still exists and is usable.
    await http()
      .get("/account/deletion-preview")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .expect(200);
  });

  it("previews and executes: Co-org inherits, solo trip is deleted, data purged, sessions revoked", async () => {
    const owner = await makeUser("owner");
    const coorg = await makeUser("coorg");
    const part = await makeUser("part");

    // Trip A: has a Co-organizer and a Participant → transfers to the Co-org.
    const tripA = await createTrip(owner.accessToken, "Has Coorg");
    await join(
      coorg.accessToken,
      await globalLink(owner.accessToken, tripA.id, "CO_ORGANIZER"),
    ).expect(201);
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, tripA.id, "PARTICIPANT"),
    ).expect(201);

    // Trip B: solo-owned → deleted.
    const tripB = await createTrip(owner.accessToken, "Solo");

    // A live session for the owner (refresh token) to prove it gets revoked.
    const refresh = await tokens_.issueRefreshToken(owner.user.id);

    // Preview reflects exactly what will happen.
    const preview = await http()
      .get("/account/deletion-preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(preview.body.transfers.length, 1);
    assert.equal(preview.body.transfers[0].tripId, tripA.id);
    assert.equal(preview.body.transfers[0].successorUserId, coorg.user.id);
    assert.equal(preview.body.deletions.length, 1);
    assert.equal(preview.body.deletions[0].tripId, tripB.id);

    // Execute deletion.
    await deleteAccount(owner.accessToken).expect(204);

    // Trip A now belongs to the Co-organizer; the old owner is gone from it.
    const detail = await http()
      .get(`/trips/${tripA.id}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .expect(200);
    assert.equal(detail.body.role, "OWNER");
    const tripARow = await prisma.trip.findUnique({ where: { id: tripA.id } });
    assert.equal(tripARow?.ownerId, coorg.user.id);
    const oldOwnerMembership = await prisma.tripMembership.findUnique({
      where: {
        tripId_userId: { tripId: tripA.id, userId: owner.user.id },
      },
    });
    assert.equal(oldOwnerMembership, null, "old owner removed from the trip");

    // Trip B (solo) is gone.
    assert.equal(
      await prisma.trip.findUnique({ where: { id: tripB.id } }),
      null,
      "solo-owned trip deleted",
    );

    // Personal data purged; the row is retained + anonymized.
    const purged = await prisma.user.findUnique({
      where: { id: owner.user.id },
    });
    assert.ok(purged, "user row retained (anonymized, not deleted)");
    assert.equal(purged.displayName, "Deleted user");
    assert.notEqual(purged.email, owner.email);
    assert.equal(purged.passwordHash, null);
    assert.equal(purged.emailVerified, false);
    assert.ok(purged.anonymizedAt, "anonymizedAt stamped");

    // No live refresh token remains, and the old cookie no longer refreshes.
    const liveTokens = await prisma.refreshToken.count({
      where: { userId: owner.user.id, revokedAt: null },
    });
    assert.equal(liveTokens, 0, "all refresh tokens revoked");
    await http()
      .post("/auth/refresh")
      .set("Cookie", `gtp_refresh=${refresh.raw}`)
      .expect(401);

    // The old access token is dead (guard rejects an anonymized user).
    await http()
      .get("/account/deletion-preview")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(401);
  });

  it("falls back to the longest-tenured Participant when there is no Co-organizer", async () => {
    const owner = await makeUser("p-owner");
    const early = await makeUser("p-early");
    const late = await makeUser("p-late");
    const trip = await createTrip(owner.accessToken, "Participants Only");
    const link = await globalLink(owner.accessToken, trip.id, "PARTICIPANT");
    await join(early.accessToken, link).expect(201);
    await join(late.accessToken, link).expect(201);

    await deleteAccount(owner.accessToken).expect(204);

    // The earlier joiner inherits ownership.
    const row = await prisma.trip.findUnique({ where: { id: trip.id } });
    assert.equal(row?.ownerId, early.user.id);
    const earlyMembership = await prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId: trip.id, userId: early.user.id } },
    });
    assert.equal(earlyMembership?.role, "OWNER");
  });

  it("never promotes a Guest — a Guest-only trip is deleted instead", async () => {
    const owner = await makeUser("g-owner");
    const guest = await makeUser("g-guest");
    const trip = await createTrip(owner.accessToken, "Guests Only");
    await join(
      guest.accessToken,
      await globalLink(owner.accessToken, trip.id, "GUEST"),
    ).expect(201);

    await deleteAccount(owner.accessToken).expect(204);

    assert.equal(
      await prisma.trip.findUnique({ where: { id: trip.id } }),
      null,
      "no eligible successor → trip deleted, Guest not promoted",
    );
  });
});
