import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import sharp from "sharp";
import type { AuthUser, TripDetail, TripMembersView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { ENV } from "../src/config/config.module.js";
import type { Env } from "../src/config/env.js";

/**
 * Cover images and avatars (Phase 6.2) — this slice's DoD:
 *
 *  - a cover shows on its trip and an avatar shows where the user appears;
 *  - **replacing either deletes the object it replaced** (no orphans);
 *  - both are organizer/self-scoped;
 *  - erasing an account takes the avatar's bytes with it (GDPR).
 */
describe("Cover + avatar (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let uploadDir: string;

  const suffix = Date.now();
  const emails: string[] = [];
  const stored: string[] = [];
  const http = () => request(app.getHttpServer());

  const png = () =>
    sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 10, g: 90, b: 200 },
      },
    })
      .png()
      .toBuffer();

  const nameOf = (url: string) => url.split("/").pop()!;
  const onDisk = async (name: string) =>
    access(resolve(uploadDir, name)).then(
      () => true,
      () => false,
    );

  async function makeUser(label: string) {
    const email = `imgwire+${label}+${suffix}@example.com`;
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
    return res.body as TripDetail;
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
    uploadDir = resolve(app.get<Env>(ENV).UPLOAD_DIR);
  });

  after(async () => {
    for (const name of stored) {
      await rm(resolve(uploadDir, name), { force: true }).catch(
        () => undefined,
      );
    }
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

  it("sets a trip cover, then deletes the old object when replaced", async () => {
    const owner = await makeUser("cover-owner");
    const trip = await createTrip(owner.accessToken, "Cover trip");

    const first = (
      await http()
        .post(`/trips/${trip.id}/cover`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .attach("file", await png(), {
          filename: "a.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body as TripDetail;

    assert.ok(first.coverImageUrl, "cover is set on the trip");
    const firstName = nameOf(first.coverImageUrl);
    stored.push(firstName);
    assert.equal(await onDisk(firstName), true, "first cover is stored");

    const second = (
      await http()
        .post(`/trips/${trip.id}/cover`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .attach("file", await png(), {
          filename: "b.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body as TripDetail;

    const secondName = nameOf(second.coverImageUrl!);
    stored.push(secondName);
    assert.notEqual(secondName, firstName, "replacement gets a fresh name");
    assert.equal(await onDisk(secondName), true, "new cover is stored");
    // The whole point of the slice: no orphan left behind.
    assert.equal(await onDisk(firstName), false, "replaced cover is deleted");

    // And removing it clears the field and the bytes.
    const cleared = (
      await http()
        .delete(`/trips/${trip.id}/cover`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200)
    ).body as TripDetail;
    assert.equal(cleared.coverImageUrl, null);
    assert.equal(await onDisk(secondName), false, "removed cover is deleted");
  });

  it("refuses a cover from a non-organizer, and 404s for a non-member", async () => {
    const owner = await makeUser("cover-guard-owner");
    const participant = await makeUser("cover-guard-part");
    const stranger = await makeUser("cover-guard-stranger");
    const trip = await createTrip(owner.accessToken, "Guarded cover");
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: participant.user.id, role: "PARTICIPANT" },
    });

    await http()
      .post(`/trips/${trip.id}/cover`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .attach("file", await png(), {
        filename: "a.png",
        contentType: "image/png",
      })
      .expect(403);

    // Non-members are told nothing about the trip's existence.
    await http()
      .post(`/trips/${trip.id}/cover`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .attach("file", await png(), {
        filename: "a.png",
        contentType: "image/png",
      })
      .expect(404);
  });

  it("sets an avatar that shows in the crew list, and cleans up on replace", async () => {
    const owner = await makeUser("avatar-owner");
    const trip = await createTrip(owner.accessToken, "Avatar trip");

    const first = (
      await http()
        .post("/account/avatar")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .attach("file", await png(), {
          filename: "me.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body as AuthUser;

    assert.ok(first.avatarUrl, "avatar is set on the user");
    const firstName = nameOf(first.avatarUrl!);
    stored.push(firstName);

    // It reaches the surfaces that show a person (DoD).
    const members = (
      await http()
        .get(`/trips/${trip.id}/members`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200)
    ).body as TripMembersView;
    assert.equal(
      members.members.find((m) => m.userId === owner.user.id)?.avatarUrl,
      first.avatarUrl,
      "avatar rides along on the member list",
    );

    const second = (
      await http()
        .post("/account/avatar")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .attach("file", await png(), {
          filename: "me2.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body as AuthUser;
    stored.push(nameOf(second.avatarUrl!));
    assert.equal(await onDisk(firstName), false, "replaced avatar is deleted");
  });

  it("purges the avatar's bytes when the account is erased (GDPR)", async () => {
    const doomed = await makeUser("avatar-erase");
    const set = (
      await http()
        .post("/account/avatar")
        .set("Authorization", `Bearer ${doomed.accessToken}`)
        .attach("file", await png(), {
          filename: "me.png",
          contentType: "image/png",
        })
        .expect(201)
    ).body as AuthUser;
    const name = nameOf(set.avatarUrl!);
    stored.push(name);
    assert.equal(await onDisk(name), true);

    await http()
      .delete("/account")
      .set("Authorization", `Bearer ${doomed.accessToken}`)
      .send({ confirm: true })
      .expect(204);

    // A photograph of someone is personal data — erasure has to take it too.
    const row = await prisma.user.findUnique({
      where: { id: doomed.user.id },
      select: { avatarUrl: true, anonymizedAt: true },
    });
    assert.ok(row?.anonymizedAt, "user is anonymized");
    assert.equal(row?.avatarUrl, null, "avatar reference is cleared");
    assert.equal(await onDisk(name), false, "avatar bytes are gone");
  });

  it("rejects a disguised non-image on both wiring routes", async () => {
    const owner = await makeUser("wire-disguise");
    const trip = await createTrip(owner.accessToken, "Disguise");
    const evil = Buffer.from('<?php system($_GET["c"]); ?>');

    // Both routes run the same Phase-6.1 pipeline — there is no second, softer
    // way in.
    await http()
      .post(`/trips/${trip.id}/cover`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .attach("file", evil, { filename: "x.png", contentType: "image/png" })
      .expect(400);

    await http()
      .post("/account/avatar")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .attach("file", evil, { filename: "x.png", contentType: "image/png" })
      .expect(400);
  });
});
