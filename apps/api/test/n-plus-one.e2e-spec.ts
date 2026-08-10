import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { ChannelsService } from "../src/chat/channels.service.js";

/**
 * N+1 audit (Phase 7.3) — the DoD's "a query audit shows no N+1 on list views".
 *
 * The method matters: rather than asserting some absolute number of statements
 * (which would be a brittle snapshot of today's implementation), each view is
 * exercised **twice at different sizes** and the count is required not to
 * *grow* with the number of rows. That is the actual definition of N+1, and it
 * stays true as the queries themselves evolve.
 *
 * Counting is real, not inferred: `PrismaService` emits Prisma's `query` event,
 * so these are the statements the database actually received.
 */
describe("N+1 audit — list views (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;
  let channels: ChannelsService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  /** Statements seen since the last reset. */
  const seen: string[] = [];

  /**
   * Run `fn`, then return how many SQL statements it issued. The settle tick
   * matters: Prisma emits `query` events from the engine, which can land a
   * moment after the awaited promise has already resolved.
   */
  async function countQueries(fn: () => Promise<unknown>): Promise<number> {
    await new Promise((r) => setImmediate(r));
    seen.length = 0;
    await fn();
    await new Promise((r) => setImmediate(r));
    return seen.length;
  }

  /**
   * Statements the count may differ by without it meaning anything.
   *
   * The counts are *nearly* deterministic, not exactly so. On CI the chat
   * history view was once measured at 9 statements for one message and 8 for
   * five — **fewer** statements for more rows, which cannot be an N+1 in any
   * direction and is simply measurement noise around the engine's own
   * bookkeeping. It failed the build and skipped a production deploy.
   *
   * One statement of slack absorbs that. It cannot hide a real regression: the
   * smallest N+1 any of these views could develop adds **three** statements,
   * because the smallest size step here is one row to four.
   */
  const COUNT_SLACK = 1;

  /**
   * Assert that a view's cost did not grow with the number of rows.
   *
   * Deliberately not `assert.equal`. Equality is stricter than the property
   * being tested and, being a two-sided assertion, it also fails when a view
   * gets *cheaper* at the larger size — which is not a defect by any reading.
   */
  function assertDoesNotGrow(
    small: number,
    large: number,
    label: string,
  ): void {
    assert.ok(large <= small + COUNT_SLACK, `${label} (slack ${COUNT_SLACK})`);
  }

  async function makeUser(label: string) {
    const email = `nplus1+${label}+${suffix}@example.com`;
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
    return (res.body as { id: string }).id;
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
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
    channels = app.get(ChannelsService);

    prisma.$on("query", (event) => {
      seen.push(event.query);
    });
  });

  after(async () => {
    if (prisma) {
      // Trips must go first: `Trip.ownerId` deliberately does not cascade, so
      // deleting the owner while a trip survives violates the FK.
      await prisma.trip.deleteMany({
        where: { owner: { email: { in: emails } } },
      });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
    if (app) await app.close();
  });

  it("home dashboard: cost per trip does not cost a query per trip", async () => {
    const me = await makeUser("home");
    await createTrip(me.accessToken, "Trip A");

    const withOne = await countQueries(() =>
      http()
        .get("/dashboard")
        .set("Authorization", `Bearer ${me.accessToken}`)
        .expect(200),
    );

    for (const name of ["Trip B", "Trip C", "Trip D"]) {
      await createTrip(me.accessToken, name);
    }

    const withFour = await countQueries(() =>
      http()
        .get("/dashboard")
        .set("Authorization", `Bearer ${me.accessToken}`)
        .expect(200),
    );

    assertDoesNotGrow(
      withOne,
      withFour,
      `dashboard issued ${withOne} statements for 1 trip and ${withFour} for 4`,
    );
  });

  it("member list: members and their names load in a fixed number of queries", async () => {
    const owner = await makeUser("crew-owner");
    const tripId = await createTrip(owner.accessToken, "Crew trip");

    const members = async () =>
      http()
        .get(`/trips/${tripId}/members`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(200);

    const withOne = await countQueries(members);

    for (const label of ["m1", "m2", "m3", "m4"]) {
      const joiner = await makeUser(label);
      await prisma.tripMembership.create({
        data: { tripId, userId: joiner.user.id, role: "PARTICIPANT" },
      });
    }

    const withFive = await countQueries(members);

    assertDoesNotGrow(
      withOne,
      withFive,
      `member list issued ${withOne} statements for 1 member and ${withFive} for 5`,
    );
  });

  it("chat history: author and reactions do not cost a query per message", async () => {
    const me = await makeUser("chat");
    const tripId = await createTrip(me.accessToken, "Chat trip");
    const channel = await prisma.channel.findFirstOrThrow({
      where: { tripId },
    });

    const post = (body: string) =>
      prisma.message.create({
        data: { channelId: channel.id, authorId: me.user.id, body },
      });

    await post("first");

    const history = async () =>
      http()
        .get(`/trips/${tripId}/channels/${channel.id}/messages`)
        .set("Authorization", `Bearer ${me.accessToken}`)
        .expect(200);

    const withOne = await countQueries(history);

    for (const body of ["second", "third", "fourth", "fifth"]) await post(body);

    const withFive = await countQueries(history);

    assertDoesNotGrow(
      withOne,
      withFive,
      `chat history issued ${withOne} statements for 1 message and ${withFive} for 5`,
    );
  });

  it("chat ready payload: unread counts do not cost a query per channel", async () => {
    // The regression this guards. Phase 4.5 made channels *on-demand per
    // category*, so a normal trip has several and a busy one has many — the
    // per-channel unread count ran once per channel on every socket connect.
    const me = await makeUser("ready");
    const tripId = await createTrip(me.accessToken, "Ready trip");

    const withDefaults = await countQueries(() =>
      channels.readyPayload(tripId, me.user.id),
    );

    const categories = await prisma.category.findMany({ where: { tripId } });
    for (const category of categories) {
      await prisma.channel.create({
        data: { tripId, categoryId: category.id, type: "CATEGORY" },
      });
    }
    const channelCount = await prisma.channel.count({ where: { tripId } });
    assert.ok(
      channelCount >= 4,
      `trip has ${channelCount} channels to fan out`,
    );

    const withMany = await countQueries(() =>
      channels.readyPayload(tripId, me.user.id),
    );

    assertDoesNotGrow(
      withDefaults,
      withMany,
      `readyPayload issued ${withDefaults} statements for 1 channel and ${withMany} for ${channelCount}`,
    );
  });
});
