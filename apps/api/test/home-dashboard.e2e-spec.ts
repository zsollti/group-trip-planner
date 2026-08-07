import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { CategoryView, HomeDashboardView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * All-trips home dashboard integration test (real DB) — the Phase-3.4 DoD:
 *  - lists Active + History trips with the correct per-currency committed cost
 *    summary and pending-decision count (decision 3);
 *  - offset pagination returns the right page + total;
 *  - the list is membership-scoped (only the caller's own trips).
 */
describe("Home dashboard (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string) {
    const email = `home+${label}+${suffix}@example.com`;
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
    return { user, accessToken };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body as { id: string };
  }

  /**
   * Widen every non-Dates built-in to multi-select and return them.
   *
   * Built-ins all seed single-choice now — multi-select became a per-trip choice
   * rather than a per-category guess — so this takes the route an organizer
   * takes rather than assuming the seed hands one over.
   */
  async function multiSelectCategories(accessToken: string, tripId: string) {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const widenable = (res.body as CategoryView[]).filter(
      (c) => c.builtinKey !== "DATES",
    );
    const out: CategoryView[] = [];
    for (const c of widenable) {
      if (!c.singleChoice) {
        out.push(c);
        continue;
      }
      const updated = await http()
        .patch(`/trips/${tripId}/categories/${c.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: c.name, singleChoice: false, version: c.version })
        .expect(200);
      out.push(updated.body as CategoryView);
    }
    return out;
  }

  async function propose(
    accessToken: string,
    tripId: string,
    categoryId: string,
    body: Record<string, unknown>,
  ) {
    const res = await http()
      .post(`/trips/${tripId}/categories/${categoryId}/options`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body)
      .expect(201);
    return res.body as { id: string; version: number };
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
      .post(
        `/trips/${tripId}/categories/${categoryId}/options/${optionId}/lock`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ optionVersion, categoryVersion })
      .expect(201);
  }

  async function home(accessToken: string, query = "") {
    const res = await http()
      .get(`/dashboard${query}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body as HomeDashboardView;
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

  it("summarizes committed cost + pending decisions, and marks History", async () => {
    const owner = await makeUser("s-owner");
    const trip = await createTrip(owner.accessToken, "Summary trip");
    const cats = await multiSelectCategories(owner.accessToken, trip.id);
    const [decided, open] = cats;

    // Category `decided`: one locked TOTAL option (committed = 200) → not pending.
    const locked = await propose(owner.accessToken, trip.id, decided!.id, {
      title: "Villa",
      amount: 200,
      currency: "EUR",
      costType: "TOTAL",
    });
    await lock(
      owner.accessToken,
      trip.id,
      decided!.id,
      locked.id,
      locked.version,
      decided!.version,
    );
    // Category `open`: a proposal with no lock → one pending decision.
    await propose(owner.accessToken, trip.id, open!.id, {
      title: "Museum pass",
      amount: 30,
      currency: "EUR",
      costType: "PER_PERSON",
    });

    // A second, ended trip (past expiry → effective History).
    const old = await createTrip(owner.accessToken, "Old trip");
    await prisma.trip.update({
      where: { id: old.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });

    const view = await home(owner.accessToken);
    assert.equal(view.total, 2);

    const summary = view.trips.find((t) => t.id === trip.id)!;
    assert.equal(summary.status, "ACTIVE");
    assert.equal(summary.role, "OWNER");
    assert.deepEqual(summary.cost, [{ currency: "EUR", committed: 200 }]);
    assert.equal(summary.pendingDecisionCount, 1);

    const oldSummary = view.trips.find((t) => t.id === old.id)!;
    assert.equal(oldSummary.status, "HISTORY");
    assert.deepEqual(oldSummary.cost, []); // nothing priced/locked
    assert.equal(oldSummary.pendingDecisionCount, 0);
  });

  it("offset-paginates the trip list", async () => {
    const owner = await makeUser("p-owner");
    await createTrip(owner.accessToken, "Trip 1");
    await createTrip(owner.accessToken, "Trip 2");
    await createTrip(owner.accessToken, "Trip 3");

    const page1 = await home(owner.accessToken, "?limit=2&offset=0");
    assert.equal(page1.total, 3);
    assert.equal(page1.limit, 2);
    assert.equal(page1.trips.length, 2);

    const page2 = await home(owner.accessToken, "?limit=2&offset=2");
    assert.equal(page2.trips.length, 1);
    // No overlap between the pages.
    const ids1 = new Set(page1.trips.map((t) => t.id));
    assert.equal(
      page2.trips.some((t) => ids1.has(t.id)),
      false,
    );
  });

  it("lists only the caller's own trips", async () => {
    const owner = await makeUser("o-owner");
    const stranger = await makeUser("o-stranger");
    const trip = await createTrip(owner.accessToken, "Private trip");

    const strangerView = await home(stranger.accessToken);
    assert.equal(strangerView.total, 0);
    assert.equal(
      strangerView.trips.some((t) => t.id === trip.id),
      false,
    );

    const ownerView = await home(owner.accessToken);
    assert.equal(
      ownerView.trips.some((t) => t.id === trip.id),
      true,
    );
  });

  it("requires authentication", async () => {
    await http().get("/dashboard").expect(401);
  });
});
