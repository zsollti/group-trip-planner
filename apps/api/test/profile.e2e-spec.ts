import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { ENV } from "../src/config/config.module.js";
import { loadEnv } from "../src/config/env.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Renaming yourself (e2e, real DB).
 *
 * The display name was set once at registration and then frozen — there was no
 * endpoint anywhere to change it, and it is the name attached to every
 * proposal, vote and message the account has ever made.
 *
 * The case worth the setup is the last one: a rename has to reach the places
 * that *show* the name without touching the places that **recorded** it. Those
 * pull in opposite directions and only a real database can tell them apart.
 */
describe("Display name (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());

  // Matches the address `makeUser("admin")` builds, so that one account is an
  // operator as far as the app is concerned.
  const adminEmail = `name+admin+${suffix}@example.com`;

  async function makeUser(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `name+${label}+${suffix}@example.com`,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
    return { user, accessToken: await tokens_.signAccessToken(user) };
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
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), ADMIN_EMAILS: [adminEmail] })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    tokens_ = app.get(TokenService);
  });

  after(async () => {
    if (prisma) {
      await prisma.trip.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  it("renames the account and answers with the updated user", async () => {
    const u = await makeUser("rename");
    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ displayName: "Ada Lovelace" })
      .expect(200);

    assert.equal(
      (res.body as { displayName: string }).displayName,
      "Ada Lovelace",
    );
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: u.user.id },
    });
    assert.equal(row.displayName, "Ada Lovelace");
  });

  /**
   * The rename answers with a full auth user, and an auth user carries the
   * operator flag — which is derived from the env list, not stored on the row.
   * Answering with a default-shaped user instead would sign an operator out of
   * their own console until the next login, with the rename itself looking
   * like it worked. The account has to be a real operator for this to mean
   * anything: with the list empty, a right and a wrong answer are both `false`.
   */
  it("keeps you an operator when you rename yourself", async () => {
    const u = await makeUser("admin");
    assert.equal(u.user.email, adminEmail);

    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ displayName: "Renamed Operator" })
      .expect(200);

    const body = res.body as { displayName: string; isAdmin: boolean };
    assert.equal(body.displayName, "Renamed Operator");
    assert.equal(body.isAdmin, true);
  });

  it("trims, so a stray space is not part of your name", async () => {
    const u = await makeUser("trim");
    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ displayName: "  Grace Hopper  " })
      .expect(200);
    assert.equal(
      (res.body as { displayName: string }).displayName,
      "Grace Hopper",
    );
  });

  it("refuses an empty name and one past the limit", async () => {
    const u = await makeUser("invalid");
    for (const displayName of ["", "   ", "x".repeat(81)]) {
      await http()
        .patch("/account/profile")
        .set("Authorization", `Bearer ${u.accessToken}`)
        .send({ displayName })
        .expect(400);
    }
    // The same rule registration is held to — not a second one that would let
    // the settings page accept a name the sign-up form refuses.
    await http()
      .post("/auth/register")
      .send({
        email: `dup+${suffix}@example.com`,
        password: "Sup3rSecret!pass",
        displayName: "",
      })
      .expect(400);
  });

  it("needs a session", async () => {
    await http()
      .patch("/account/profile")
      .send({ displayName: "Nobody" })
      .expect(401);
  });

  it("stores the language on the account, and hands it back on the session", async () => {
    // The language lives on the account rather than in a browser, so the same
    // reader gets the same language on their phone as on their laptop. `/auth/me`
    // is what the app reads it from — it has to arrive with the session, or the
    // first screen after sign-in would repaint in front of the reader.
    const u = await makeUser("locale");
    const before = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .expect(200);
    assert.equal(
      (before.body as { locale: string }).locale,
      "en",
      "an account that has never said reads the app in the default",
    );

    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ locale: "en" })
      .expect(200);
    assert.equal((res.body as { locale: string }).locale, "en");
  });

  it("changes the language without being told the name again", async () => {
    // The two settings are edited by two different forms. A PATCH that demanded
    // `displayName` would make the language switch resubmit a name it never
    // asked about — which is how one screen quietly reverts another's edit.
    const u = await makeUser("locale-only");
    await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ displayName: "Ada Lovelace" })
      .expect(200);

    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ locale: "en" })
      .expect(200);
    assert.equal(
      (res.body as { displayName: string }).displayName,
      "Ada Lovelace",
      "the name it was not asked about is untouched",
    );
  });

  it("stores a language it has been translated into", async () => {
    // Hungarian shipped, so this is the happy path now. It was a 400 while the
    // dictionaries were being written, and that is what kept a half-English screen
    // unreachable rather than merely unlikely.
    const u = await makeUser("locale-hu");
    const res = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ locale: "hu" })
      .expect(200);
    assert.equal((res.body as { locale: string }).locale, "hu");
  });

  it("refuses a language it has not been translated into, and an empty patch", async () => {
    const u = await makeUser("locale-bad");
    // The guard is unchanged and still does its job: a language with no dictionary
    // is refused, so a reader cannot reach a screen half in their language.
    for (const body of [
      { locale: "de" },
      { locale: "klingon" },
      { locale: "" },
    ]) {
      await http()
        .patch("/account/profile")
        .set("Authorization", `Bearer ${u.accessToken}`)
        .send(body)
        .expect(400);
    }
    // And a request that asks for nothing is a mistake, not a no-op.
    await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({})
      .expect(400);
  });

  it("does not require a verified email", async () => {
    // Verification gates the high-risk actions — creating trips and invites.
    // An unverified account stuck with a typo in its own name would be a worse
    // outcome than the one being prevented.
    const user = await prisma.user.create({
      data: {
        email: `name+unverified+${suffix}@example.com`,
        displayName: "Typo",
        emailVerified: false,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
    await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${await tokens_.signAccessToken(user)}`)
      .send({ displayName: "Fixed" })
      .expect(200);
  });

  it("renames you everywhere you are shown, and nowhere you are quoted", async () => {
    const owner = await makeUser("owner");
    const trip = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Lisbon", defaultCurrency: "EUR" })
      .expect(201);
    const tripId = (trip.body as { id: string }).id;

    const cats = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const categoryId = (cats.body as { id: string; builtinKey: string }[]).find(
      (c) => c.builtinKey === "ACCOMMODATION",
    )!.id;

    await http()
      .post(`/trips/${tripId}/categories/${categoryId}/options`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "Hostel",
        currency: "EUR",
        costType: "PER_PERSON",
        participationMode: "WHOLE_GROUP",
      })
      .expect(201);

    await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ displayName: "Renamed Owner" })
      .expect(200);

    // Shown: the proposer's name is read through a join at request time, so
    // one row changing is the whole change.
    const options = await http()
      .get(`/trips/${tripId}/categories/${categoryId}/options`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.equal(
      (options.body as { proposerName: string }[])[0]!.proposerName,
      "Renamed Owner",
    );

    // ...and the members list, which is the same join.
    const members = await http()
      .get(`/trips/${tripId}/members`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.ok(
      (members.body as { members: { displayName: string }[] }).members.some(
        (m) => m.displayName === "Renamed Owner",
      ),
    );
  });

  /**
   * The guided tour's one bit of persistence.
   *
   * On the account rather than in the browser because "skippable, but available
   * later" needs somewhere stable — a per-browser flag means the tour ambushes
   * the same person again from their phone. So it travels on the session, and
   * these are the two directions it can go.
   */
  it("records that the tour has been seen, and hands the fact back", async () => {
    const u = await makeUser("tour");

    // A fresh account has never seen it: that null is what makes the board
    // offer it on the first one they open.
    const before = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .expect(200);
    assert.equal(
      (before.body as { tourCompletedAt: unknown }).tourCompletedAt,
      null,
    );

    const done = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ tourCompleted: true })
      .expect(200);
    const at = (done.body as { tourCompletedAt: string }).tourCompletedAt;
    // A timestamp, not a boolean — "yes" and "yes, in March" cost the same to
    // store, and the response is what the session carries.
    assert.ok(at, "an instant was recorded");
    assert.ok(!Number.isNaN(Date.parse(at)));

    // It survives the round trip rather than living in the response only.
    const after = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .expect(200);
    assert.equal(
      (after.body as { tourCompletedAt: string }).tourCompletedAt,
      at,
    );

    // And it can be handed back, which is what a "show it to me again on every
    // device" control would use. Nothing offers that today; the column is
    // symmetrical because a one-way flag is a migration waiting to happen.
    const reset = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ tourCompleted: false })
      .expect(200);
    assert.equal(
      (reset.body as { tourCompletedAt: unknown }).tourCompletedAt,
      null,
    );
  });

  /**
   * The overview's own tour is counted on its own column, and this is the fact
   * that keeps them apart on the server side.
   *
   * Two columns because the overview tour ends by promising the reader that
   * making a trip will get them shown around the board. One shared flag would
   * have the overview tour set it and the board tour then never auto-start,
   * which breaks that promise on the very next screen.
   */
  it("counts the overview's tour separately from the board's", async () => {
    const u = await makeUser("overviewtour");

    const done = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ overviewTourCompleted: true })
      .expect(200);
    const body = done.body as {
      overviewTourCompletedAt: string;
      tourCompletedAt: unknown;
    };
    assert.ok(body.overviewTourCompletedAt, "an instant was recorded");
    // The board's own mark is untouched, which is the whole point of there
    // being two of them.
    assert.equal(body.tourCompletedAt, null);

    const after = await http()
      .get("/auth/me")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .expect(200);
    assert.equal(
      (after.body as { overviewTourCompletedAt: string })
        .overviewTourCompletedAt,
      body.overviewTourCompletedAt,
    );
  });

  it("marks the tour done without being told the name again", async () => {
    // The same property the language switch has, and for the same reason: a
    // form that resubmits a field it does not own is how one screen quietly
    // reverts another's edit.
    const u = await makeUser("tour-alone");
    await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ displayName: "Ada Lovelace" })
      .expect(200);

    const done = await http()
      .patch("/account/profile")
      .set("Authorization", `Bearer ${u.accessToken}`)
      .send({ tourCompleted: true })
      .expect(200);
    assert.equal(
      (done.body as { displayName: string }).displayName,
      "Ada Lovelace",
    );
  });
});
