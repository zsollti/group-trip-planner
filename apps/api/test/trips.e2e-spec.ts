import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * Trips spine integration test (real DB). Covers the Phase-1.1 DoD:
 * - a verified user creates a trip and becomes Owner;
 * - an unverified user is blocked from creating (verified-email gate);
 * - the trip shows up in the owner's list;
 * - a non-member hitting GET /trips/:id gets a 404 (existence not leaked);
 * - the public preview returns only the four allowed Visitor fields.
 */
describe("Trips (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Captured verification tokens, keyed by email.
  const tokens = new Map<string, string>();
  const suffix = Date.now();
  const emails: string[] = [];

  /** Register + (optionally) verify + login; returns a cookie-carrying agent
   * and the in-memory access token. */
  async function makeUser(opts: { verified: boolean; label: string }) {
    const email = `trips+${opts.label}+${suffix}@example.com`;
    emails.push(email);
    const password = "correct-horse-battery";
    const agent = request.agent(app.getHttpServer());

    await agent
      .post("/auth/register")
      .send({ email, password, displayName: opts.label })
      .expect(201);

    if (opts.verified) {
      const token = tokens.get(email);
      assert.ok(token, `verification token issued for ${email}`);
      await agent.post("/auth/verify").send({ token }).expect(200);
    }

    const login = await agent
      .post("/auth/login")
      .send({ email, password })
      .expect(200);
    return { agent, accessToken: login.body.accessToken as string, email };
  }

  before(async () => {
    const emailMock = {
      sendVerificationEmail: (to: string, token: string) => {
        tokens.set(to, token);
        return Promise.resolve();
      },
      sendAccountExistsNotice: () => Promise.resolve(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(emailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  });

  after(async () => {
    if (prisma) {
      // Trips cascade their memberships; then remove the test users.
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

  it("a verified user creates a trip and becomes Owner", async () => {
    const owner = await makeUser({ verified: true, label: "owner" });

    const res = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Lisbon 2026", destination: "Lisbon" });

    assert.equal(res.status, 201);
    assert.equal(res.body.name, "Lisbon 2026");
    assert.equal(res.body.role, "OWNER");
    assert.equal(res.body.memberCount, 1);
    assert.equal(res.body.status, "ACTIVE");
    assert.equal(res.body.defaultCurrency, "EUR");
    assert.ok(res.body.expiresAt, "an expiry fallback is set");

    // It appears in the owner's trip list.
    const list = await owner.agent
      .get("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.ok(
      list.body.some(
        (t: { id: string }) => t.id === (res.body as { id: string }).id,
      ),
      "created trip is in the list",
    );
  });

  it("an unverified user cannot create a trip", async () => {
    const rookie = await makeUser({ verified: false, label: "rookie" });
    const res = await rookie.agent
      .post("/trips")
      .set("Authorization", `Bearer ${rookie.accessToken}`)
      .send({ name: "Should Fail" });
    assert.equal(res.status, 403);
  });

  it("a non-member hitting /trips/:id gets 404, not 403", async () => {
    const owner = await makeUser({ verified: true, label: "owner2" });
    const stranger = await makeUser({ verified: true, label: "stranger" });

    const created = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Private Trip" })
      .expect(201);

    const asStranger = await stranger.agent
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);
    assert.equal(
      asStranger.status,
      404,
      "existence is not leaked to outsiders",
    );

    const asMember = await owner.agent
      .get(`/trips/${created.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(asMember.body.id, created.body.id);
  });

  it("the public preview returns only the four Visitor fields", async () => {
    const owner = await makeUser({ verified: true, label: "owner3" });
    const created = await owner.agent
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Preview Me", destination: "Porto", description: "secret" })
      .expect(201);

    // No auth header — this is the public Visitor scope.
    const preview = await request(app.getHttpServer())
      .get(`/trips/${created.body.id}/preview`)
      .expect(200);

    assert.deepEqual(
      Object.keys(preview.body).sort(),
      ["destination", "endDate", "id", "memberCount", "name", "startDate"],
      "preview leaks nothing beyond the four allowed fields + id",
    );
    assert.equal(preview.body.name, "Preview Me");
    assert.equal(preview.body.destination, "Porto");
    assert.equal(preview.body.memberCount, 1);
    assert.equal(preview.body.description, undefined);
    assert.equal(preview.body.role, undefined);
    assert.equal(preview.body.ownerId, undefined);
  });

  it("preview of a nonexistent trip is a 404", async () => {
    const res = await request(app.getHttpServer()).get(
      "/trips/00000000-0000-4000-8000-000000000000/preview",
    );
    assert.equal(res.status, 404);
  });
});
