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
 * Atomic-locking integration test (real DB) — the Phase-2.4 backbone and one of
 * the SRS §10 backbone tests. Proves:
 *  - **the second concurrent locker is rejected** for BOTH guard paths:
 *    multi-select (per-Option.version) and single-choice (per-Category.version);
 *  - a single-choice lock **displaces** the previously-locked sibling atomically;
 *  - every lock/unlock writes an **AuditEvent**;
 *  - locking is **Organizers only** (a Participant is 403) and **Active-trip only**
 *    (a History trip is frozen); unlock reverts.
 */
describe("Locking (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string) {
    const email = `lock+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
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

  /** Return the trip's categories keyed by builtinKey (for single/multi choice). */
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
    return res.body as { id: string; version: number };
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

  it("multi-select: the second locker of the SAME option (stale version) is rejected", async () => {
    const owner = await makeUser("ms-owner");
    const trip = await createTrip(owner.accessToken, "Multi lock race");
    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.TRANSPORT!; // multi-select
    const opt = await propose(owner.accessToken, trip.id, transport.id, "FR1234");
    const url = `${optionsUrl(trip.id, transport.id)}/${opt.id}/lock`;
    const body = { optionVersion: opt.version, categoryVersion: transport.version };

    // First lock wins.
    const first = await http()
      .post(url)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(201);
    assert.equal(first.body.status, "LOCKED");
    assert.equal(first.body.lockedByName, "ms-owner");

    // Second lock re-using the now-stale option version 0 is rejected (409).
    await http()
      .post(url)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(409);

    // Exactly one lock AuditEvent for this option.
    const audits = await prisma.auditEvent.findMany({
      where: { tripId: trip.id, targetId: opt.id, action: "OPTION_LOCKED" },
    });
    assert.equal(audits.length, 1);
  });

  it("single-choice: the second locker of a DIFFERENT option (stale category version) is rejected", async () => {
    const owner = await makeUser("sc-owner");
    const trip = await createTrip(owner.accessToken, "Single lock race");
    const cats = await categories(owner.accessToken, trip.id);
    const stay = cats.ACCOMMODATION!; // single-choice
    const a = await propose(owner.accessToken, trip.id, stay.id, "Hotel A");
    const b = await propose(owner.accessToken, trip.id, stay.id, "Hostel B");

    // Both organizers read the SAME category version, then race to lock A vs B.
    const catVersion = stay.version;

    await http()
      .post(`${optionsUrl(trip.id, stay.id)}/${a.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: a.version, categoryVersion: catVersion })
      .expect(201);

    // Locking B with the stale category version loses the race → 409.
    await http()
      .post(`${optionsUrl(trip.id, stay.id)}/${b.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: b.version, categoryVersion: catVersion })
      .expect(409);

    // Only A is locked; B stayed proposed — one decision stands.
    const list = await http()
      .get(optionsUrl(trip.id, stay.id))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const rows = list.body as { id: string; status: string }[];
    assert.equal(rows.find((o) => o.id === a.id)!.status, "LOCKED");
    assert.equal(rows.find((o) => o.id === b.id)!.status, "PROPOSED");
  });

  it("single-choice: locking a new option displaces the previously-locked sibling (audited)", async () => {
    const owner = await makeUser("disp-owner");
    const trip = await createTrip(owner.accessToken, "Displace");
    let cats = await categories(owner.accessToken, trip.id);
    const stay = cats.ACCOMMODATION!;
    const a = await propose(owner.accessToken, trip.id, stay.id, "Place A");
    const b = await propose(owner.accessToken, trip.id, stay.id, "Place B");

    // Lock A.
    await http()
      .post(`${optionsUrl(trip.id, stay.id)}/${a.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: a.version, categoryVersion: stay.version })
      .expect(201);

    // Re-read the bumped category version, then lock B (should unlock A).
    cats = await categories(owner.accessToken, trip.id);
    await http()
      .post(`${optionsUrl(trip.id, stay.id)}/${b.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: 0, categoryVersion: cats.ACCOMMODATION!.version })
      .expect(201);

    const list = await http()
      .get(optionsUrl(trip.id, stay.id))
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const rows = list.body as { id: string; status: string }[];
    assert.equal(rows.find((o) => o.id === a.id)!.status, "PROPOSED"); // displaced
    assert.equal(rows.find((o) => o.id === b.id)!.status, "LOCKED");

    // A's auto-unlock and B's lock are both audited.
    const audits = await prisma.auditEvent.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: "asc" },
    });
    const aUnlock = audits.find(
      (e) => e.targetId === a.id && e.action === "OPTION_UNLOCKED",
    );
    assert.ok(aUnlock, "A's supersession is audited");
    assert.ok(
      audits.some((e) => e.targetId === b.id && e.action === "OPTION_LOCKED"),
      "B's lock is audited",
    );
  });

  it("unlock reverts a locked option (audited); a stale unlock is a 409", async () => {
    const owner = await makeUser("un-owner");
    const trip = await createTrip(owner.accessToken, "Unlock");
    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.TRANSPORT!;
    const opt = await propose(owner.accessToken, trip.id, transport.id, "Bus");

    const locked = await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.id}/lock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ optionVersion: opt.version, categoryVersion: transport.version })
      .expect(201);
    const lockedVersion = locked.body.version as number;

    // A stale unlock version is rejected.
    await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.id}/unlock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ version: opt.version }) // pre-lock version, now stale
      .expect(409);

    // The current version unlocks it.
    const unlocked = await http()
      .post(`${optionsUrl(trip.id, transport.id)}/${opt.id}/unlock`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ version: lockedVersion })
      .expect(201);
    assert.equal(unlocked.body.status, "PROPOSED");
    assert.equal(unlocked.body.lockedByName, null);

    const audits = await prisma.auditEvent.findMany({
      where: { tripId: trip.id, targetId: opt.id, action: "OPTION_UNLOCKED" },
    });
    assert.equal(audits.length, 1);
  });

  it("locking is Organizers-only and Active-trip-only", async () => {
    const owner = await makeUser("gd-owner");
    const part = await makeUser("gd-part");
    const trip = await createTrip(owner.accessToken, "Guarded lock");
    await join(
      part.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);
    const cats = await categories(owner.accessToken, trip.id);
    const transport = cats.TRANSPORT!;
    const opt = await propose(owner.accessToken, trip.id, transport.id, "Train");
    const url = `${optionsUrl(trip.id, transport.id)}/${opt.id}/lock`;
    const body = { optionVersion: opt.version, categoryVersion: transport.version };

    // A Participant cannot lock (decision.lock excludes Participant → 403).
    await http()
      .post(url)
      .set("Authorization", `Bearer ${part.accessToken}`)
      .send(body)
      .expect(403);

    // Freeze the trip → even the Owner cannot lock.
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "HISTORY" },
    });
    await http()
      .post(url)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send(body)
      .expect(403);
  });
});
