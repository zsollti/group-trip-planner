import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { DEFAULT_MAX_PERSONAL_ITEMS, type PersonalItemView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Personal items integration test (real DB).
 *
 * **The case this file exists for is member-versus-member.** `backbone-idor`
 * already sweeps every trip-scoped route with a stranger and requires a 404,
 * and it now covers these five too — but a stranger is the easy half. These
 * rows are private *within* a trip, so the interesting attacker is someone who
 * legitimately passes both guards: a real member, on the right board, holding
 * a real item id that simply is not theirs. No guard in the request pipeline
 * separates those two people; only the `{ tripId, ownerId }` scoping in the
 * service does, and that is what is asserted here.
 *
 * The rest is the surrounding contract: a Guest may keep a list (the one
 * capability every role holds), a lane tag has to belong to this trip, deleting
 * a lane must not destroy other people's rows, leaving takes the list with it,
 * and the cap and freeze behave like every other write in the app.
 */
describe("Personal items (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string) {
    const email = `pers+${label}+${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: label,
        emailVerified: true,
        passwordHash: "x",
      },
    });
    return { user, accessToken: await tokens_.signAccessToken(user), email };
  }

  async function createTrip(accessToken: string, name: string) {
    const res = await http()
      .post("/trips")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** Add `who` to `tripId` at `role`, through a real invite link. */
  async function addMember(
    ownerToken: string,
    tripId: string,
    who: { accessToken: string },
    role: "PARTICIPANT" | "GUEST" | "CO_ORGANIZER" = "PARTICIPANT",
  ) {
    const invite = await http()
      .post(`/trips/${tripId}/invites`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ type: "GLOBAL", role })
      .expect(201);
    await http()
      .post(`/join/${(invite.body as { token: string }).token}`)
      .set("Authorization", `Bearer ${who.accessToken}`)
      .expect(201);
  }

  function list(accessToken: string, tripId: string) {
    return http()
      .get(`/trips/${tripId}/personal-items`)
      .set("Authorization", `Bearer ${accessToken}`);
  }

  function add(
    accessToken: string,
    tripId: string,
    body: Record<string, unknown>,
  ) {
    return http()
      .post(`/trips/${tripId}/personal-items`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body);
  }

  async function categoryOf(
    accessToken: string,
    tripId: string,
    key: string,
  ): Promise<string> {
    const res = await http()
      .get(`/trips/${tripId}/categories`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return (res.body as { id: string; builtinKey: string | null }[]).find(
      (c) => c.builtinKey === key,
    )!.id;
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

  it("keeps one member's list invisible to another member of the same trip", async () => {
    const owner = await makeUser("owner-a");
    const other = await makeUser("other-a");
    const trip = await createTrip(owner.accessToken, "Private lists");
    await addMember(owner.accessToken, trip, other);

    const mine = await add(owner.accessToken, trip, {
      title: "Flight home",
      currency: "EUR",
      amount: 210,
    }).expect(201);
    const itemId = (mine.body as PersonalItemView).id;

    // The other member is on the board, passes TripContextGuard, holds
    // `personalItem.manage` — and still sees nothing.
    const theirs = await list(other.accessToken, trip).expect(200);
    assert.deepEqual(theirs.body, [], "another member's list is their own");

    // 404 and not 403 on both writes: a 403 would confirm the row exists.
    await http()
      .patch(`/trips/${trip}/personal-items/${itemId}`)
      .set("Authorization", `Bearer ${other.accessToken}`)
      .send({ title: "Hijacked", currency: "EUR" })
      .expect(404);
    await http()
      .delete(`/trips/${trip}/personal-items/${itemId}`)
      .set("Authorization", `Bearer ${other.accessToken}`)
      .expect(404);

    // And the row is untouched by either attempt.
    const after_ = (await list(owner.accessToken, trip).expect(200))
      .body as PersonalItemView[];
    assert.equal(after_.length, 1);
    assert.equal(after_[0]?.title, "Flight home");
  });

  it("never names an owner in the payload", async () => {
    const owner = await makeUser("owner-shape");
    const trip = await createTrip(owner.accessToken, "Shape");
    const res = await add(owner.accessToken, trip, {
      title: "Insurance",
      currency: "EUR",
    }).expect(201);

    // The view has no shape in which it can describe somebody else — the point
    // of leaving `ownerId` off the mapper rather than merely not selecting it.
    assert.ok(
      !("ownerId" in (res.body as object)),
      "no ownerId on the personal item view",
    );
  });

  it("lets a Guest keep a list", async () => {
    const owner = await makeUser("owner-guest");
    const guest = await makeUser("guest");
    const trip = await createTrip(owner.accessToken, "Guest list");
    await addMember(owner.accessToken, trip, guest, "GUEST");

    // The one capability every role holds. A Guest deciding whether to join is
    // exactly who wants to price their own flight first.
    await add(guest.accessToken, trip, {
      title: "Train ticket",
      currency: "EUR",
      amount: 40,
    }).expect(201);
    const mine = await list(guest.accessToken, trip).expect(200);
    assert.equal((mine.body as PersonalItemView[]).length, 1);
  });

  it("refuses a lane tag that belongs to another trip", async () => {
    const owner = await makeUser("owner-tag");
    const mine = await createTrip(owner.accessToken, "Mine");
    const elsewhere = await createTrip(owner.accessToken, "Elsewhere");
    const foreign = await categoryOf(owner.accessToken, elsewhere, "TRANSPORT");

    // A uuid that parses is not a uuid that belongs here — even when the caller
    // is a legitimate member of *both* trips.
    await add(owner.accessToken, mine, {
      title: "Tagged wrong",
      currency: "EUR",
      categoryId: foreign,
    }).expect(404);
  });

  it("unties the tag when the lane goes, instead of deleting the item", async () => {
    const owner = await makeUser("owner-lane");
    const member = await makeUser("member-lane");
    const trip = await createTrip(owner.accessToken, "Lane deletion");
    await addMember(owner.accessToken, trip, member);

    const custom = await http()
      .post(`/trips/${trip}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Side quests" })
      .expect(201);
    const categoryId = (custom.body as { id: string }).id;

    await add(member.accessToken, trip, {
      title: "Museum pass",
      currency: "EUR",
      amount: 25,
      categoryId,
    }).expect(201);

    // An organizer tidying up the board must not reach into a private row they
    // cannot even see. `SetNull`, never cascade.
    await http()
      .delete(`/trips/${trip}/categories/${categoryId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);

    const after_ = await list(member.accessToken, trip).expect(200);
    const items = after_.body as PersonalItemView[];
    assert.equal(items.length, 1, "the item survived its lane");
    assert.equal(items[0]?.categoryId, null, "and lost only its colour");
    assert.equal(items[0]?.amount, 25);
  });

  it("takes a departing member's list with them", async () => {
    const owner = await makeUser("owner-leave");
    const leaver = await makeUser("leaver");
    const trip = await createTrip(owner.accessToken, "Leaving");
    await addMember(owner.accessToken, trip, leaver);

    await add(leaver.accessToken, trip, {
      title: "Bus from airport",
      currency: "EUR",
    }).expect(201);

    await http()
      .post(`/trips/${trip}/members/leave`)
      .set("Authorization", `Bearer ${leaver.accessToken}`)
      .expect(204);

    // Not for the reasons votes and participations go — those distorted a
    // shared tally. These go because their owner has no route left that would
    // ever return them, so surviving would mean private data with no reader.
    const left = await prisma.personalItem.count({
      where: { tripId: trip, ownerId: leaver.user.id },
    });
    assert.equal(left, 0, "no orphaned private rows behind a departed member");
  });

  it("caps one member's list without touching anyone else's", async () => {
    const owner = await makeUser("owner-cap");
    const other = await makeUser("other-cap");
    const trip = await createTrip(owner.accessToken, "Cap");
    await addMember(owner.accessToken, trip, other);

    await prisma.personalItem.createMany({
      data: Array.from({ length: DEFAULT_MAX_PERSONAL_ITEMS }, (_, i) => ({
        tripId: trip,
        ownerId: owner.user.id,
        title: `Item ${i}`,
        currency: "EUR",
        position: i,
      })),
    });

    await add(owner.accessToken, trip, {
      title: "One too many",
      currency: "EUR",
    }).expect(403);

    // The cap counts this member's rows, not the trip's: an enthusiastic
    // planner cannot use up a limit on their friends' behalf.
    await add(other.accessToken, trip, {
      title: "Still fine",
      currency: "EUR",
    }).expect(201);
  });

  it("rejects a reorder padded with someone else's id, without saying which", async () => {
    const owner = await makeUser("owner-reorder");
    const other = await makeUser("other-reorder");
    const trip = await createTrip(owner.accessToken, "Reorder");
    await addMember(owner.accessToken, trip, other);

    const a = await add(owner.accessToken, trip, {
      title: "First",
      currency: "EUR",
    }).expect(201);
    const b = await add(owner.accessToken, trip, {
      title: "Second",
      currency: "EUR",
    }).expect(201);
    const theirs = await add(other.accessToken, trip, {
      title: "Theirs",
      currency: "EUR",
    }).expect(201);

    const mineIds = [
      (a.body as PersonalItemView).id,
      (b.body as PersonalItemView).id,
    ];

    // The completeness rule is doing the authorization here: a padded list is a
    // malformed reorder, and the refusal says nothing about the extra id.
    const res = await http()
      .post(`/trips/${trip}/personal-items/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: [...mineIds, (theirs.body as PersonalItemView).id] })
      .expect(400);
    assert.ok(
      !JSON.stringify(res.body).includes((theirs.body as PersonalItemView).id),
      "the refusal does not echo the stranger id back",
    );

    // The other member's row is untouched, and still theirs.
    const stillTheirs = await list(other.accessToken, trip).expect(200);
    assert.equal((stillTheirs.body as PersonalItemView[]).length, 1);

    // The honest reorder works and is gap-free.
    const ok = await http()
      .post(`/trips/${trip}/personal-items/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: [mineIds[1], mineIds[0]] })
      .expect(201);
    assert.deepEqual(
      (ok.body as PersonalItemView[]).map((i) => [i.title, i.position]),
      [
        ["Second", 0],
        ["First", 1],
      ],
    );
  });

  it("stops accepting writes once the trip has ended", async () => {
    const owner = await makeUser("owner-frozen");
    const trip = await createTrip(owner.accessToken, "Ended");
    await add(owner.accessToken, trip, {
      title: "Before",
      currency: "EUR",
    }).expect(201);

    await prisma.trip.update({
      where: { id: trip },
      data: { status: "HISTORY" },
    });

    await add(owner.accessToken, trip, {
      title: "After",
      currency: "EUR",
    }).expect(403);

    // Reading a finished trip's own list still works — freezing a trip stops
    // it changing, it does not take it away.
    const mine = await list(owner.accessToken, trip).expect(200);
    assert.equal((mine.body as PersonalItemView[]).length, 1);
  });

  it("clears an omitted field on edit, like an option does", async () => {
    const owner = await makeUser("owner-edit");
    const trip = await createTrip(owner.accessToken, "Editing");
    const categoryId = await categoryOf(owner.accessToken, trip, "TRANSPORT");

    const made = await add(owner.accessToken, trip, {
      title: "Flight out",
      currency: "EUR",
      amount: 180,
      description: "Window seat",
      categoryId,
    }).expect(201);
    const id = (made.body as PersonalItemView).id;

    const edited = await http()
      .patch(`/trips/${trip}/personal-items/${id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ title: "Flight out", currency: "EUR" })
      .expect(200);

    const view = edited.body as PersonalItemView;
    assert.equal(view.amount, null, "a full replace clears the amount");
    assert.equal(view.description, null);
    assert.equal(view.categoryId, null, "and unties the tag");
  });
});
