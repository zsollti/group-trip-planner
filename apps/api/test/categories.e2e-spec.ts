import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { BUILTIN_CATEGORIES, maxTripCategories } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { EmailService } from "../src/email/email.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";

/**
 * Categories integration test (real DB) — the Phase-2.1 DoD:
 *  - a new trip is seeded with the four built-ins at the right single_choice
 *    defaults and positions;
 *  - an Organizer creates/renames/reorders/deletes; a rename conflict is a 409;
 *  - a non-Organizer is 403, a non-member is 404;
 *  - delete is a hard cascade (the row is gone);
 *  - the policy-layer category cap and the 32-character name cap hold.
 */
describe("Categories (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const suffix = Date.now();
  const emails: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeUser(label: string, verified = true) {
    const email = `cat+${label}+${suffix}@example.com`;
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

  type Cat = {
    id: string;
    name: string;
    singleChoice: boolean;
    isBuiltin: boolean;
    builtinKey: string | null;
    paletteKey: string | null;
    position: number;
    version: number;
  };

  function listCategories(accessToken: string, tripId: string) {
    return http()
      .get(`/trips/${tripId}/categories`)
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

  it("seeds a new trip with the four built-ins at the right defaults", async () => {
    const owner = await makeUser("seed-owner");
    const trip = await createTrip(owner.accessToken, "Seeded Trip");

    const res = await listCategories(owner.accessToken, trip.id).expect(200);
    const cats = res.body as Cat[];

    assert.deepEqual(
      cats.map((c) => c.builtinKey),
      ["DATES", "TRANSPORT", "ACCOMMODATION", "ACTIVITIES"],
      "built-ins in display order — Budget is retired from the seed",
    );
    assert.ok(
      cats.every((c) => c.isBuiltin),
      "all seeded categories are built-in",
    );
    const byKey = Object.fromEntries(cats.map((c) => [c.builtinKey, c]));
    // Multi-select is the seeded default now — a trip keeps several activities
    // and often several legs. Dates is the exception, and not a default: it
    // holds the one range the trip writes back (canBeMultiSelect).
    for (const c of cats) {
      assert.equal(
        c.singleChoice,
        c.builtinKey === "DATES",
        `${c.builtinKey} seeds the documented mode`,
      );
    }
    assert.ok(byKey.DATES, "Dates is seeded");
    assert.deepEqual(
      cats.map((c) => c.position),
      [0, 1, 2, 3],
    );
  });

  it("lets an Organizer create a custom category, appended at the end", async () => {
    const owner = await makeUser("create-owner");
    const trip = await createTrip(owner.accessToken, "Custom Cats");

    const created = await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Packing list", singleChoice: true })
      .expect(201);
    assert.equal(created.body.isBuiltin, false);
    assert.equal(created.body.builtinKey, null);
    assert.equal(created.body.singleChoice, true);
    assert.equal(created.body.position, 4, "appended after the four built-ins");

    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    assert.equal(cats.length, BUILTIN_CATEGORIES.length + 1);
  });

  it("refuses a category past the policy cap, built-ins counted", async () => {
    const owner = await makeUser("cap-owner");
    const trip = await createTrip(owner.accessToken, "Full Board");

    // The built-ins are seeded, so the cap allows exactly the remainder.
    const room = maxTripCategories() - BUILTIN_CATEGORIES.length;
    for (let i = 0; i < room; i++) {
      await http()
        .post(`/trips/${trip.id}/categories`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: `Extra ${i}`, singleChoice: false })
        .expect(201);
    }

    const refused = await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "One too many", singleChoice: false })
      .expect(403);
    assert.match(refused.body.message, /limit of 8 categories/);

    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    assert.equal(cats.length, maxTripCategories(), "the cap held");

    // Deleting one makes room again — the cap is a ceiling, not a one-way door.
    const extra = cats.find((c) => c.name === "Extra 0");
    assert.ok(extra);
    await http()
      .delete(`/trips/${trip.id}/categories/${extra.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);
    await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Room again", singleChoice: false })
      .expect(201);
  });

  it("rejects a name longer than the 32-character cap", async () => {
    const owner = await makeUser("cap-name-owner");
    const trip = await createTrip(owner.accessToken, "Long Names");

    await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "x".repeat(33), singleChoice: false })
      .expect(400);
    await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "x".repeat(32), singleChoice: false })
      .expect(201);
  });

  it("renames with optimistic concurrency — a stale version is a 409", async () => {
    const owner = await makeUser("rename-owner");
    const trip = await createTrip(owner.accessToken, "Rename Me");
    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    const dates = cats.find((c) => c.builtinKey === "DATES")!;
    assert.equal(dates.version, 0);

    const renamed = await http()
      .patch(`/trips/${trip.id}/categories/${dates.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "When", singleChoice: true, paletteKey: null, version: 0 })
      .expect(200);
    assert.equal(renamed.body.name, "When");
    assert.equal(renamed.body.version, 1, "version bumped");
    assert.equal(renamed.body.builtinKey, "DATES", "identity survives rename");

    // Re-sending the now-stale version 0 is rejected with a reload prompt.
    await http()
      .patch(`/trips/${trip.id}/categories/${dates.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        name: "Whenever",
        singleChoice: true,
        paletteKey: null,
        version: 0,
      })
      .expect(409);
  });

  /**
   * A lane's colour (post-launch). The interesting property is not that the
   * value round-trips — it is that it is **shared**: the colour is how everyone
   * on the trip recognises the lane, so a repaint that only its author could
   * see would be a per-user setting wearing a per-trip setting's clothes.
   */
  describe("palette", () => {
    it("seeds every lane with no palette, meaning the derived default", async () => {
      // Null is not a value to repair. It is what every category carried before
      // this was choosable, and what the front-end reads as "the colour this
      // lane was always going to have".
      const owner = await makeUser("palette-seed");
      const trip = await createTrip(owner.accessToken, "Fresh Paint");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      assert.ok(cats.length > 0);
      for (const c of cats) assert.equal(c.paletteKey, null);
    });

    it("shows a chosen palette to the rest of the trip, not just its author", async () => {
      const owner = await makeUser("palette-owner");
      const other = await makeUser("palette-member");
      const trip = await createTrip(owner.accessToken, "Repaint");
      await join(
        other.accessToken,
        await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
      ).expect(201);

      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const stay = cats.find((c) => c.builtinKey === "ACCOMMODATION")!;

      const painted = await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: stay.name,
          singleChoice: stay.singleChoice,
          paletteKey: "JADE",
          version: stay.version,
        })
        .expect(200);
      assert.equal(painted.body.paletteKey, "JADE");
      assert.equal(painted.body.version, stay.version + 1);

      // The point of the whole slice: another member's board is repainted too.
      const theirs = (
        await listCategories(other.accessToken, trip.id).expect(200)
      ).body as Cat[];
      assert.equal(
        theirs.find((c) => c.id === stay.id)!.paletteKey,
        "JADE",
        "a colour picked by one member is what the trip sees",
      );
    });

    it("takes null as the way back to the lane's own colour", async () => {
      // Not "leave this field alone" — the endpoint is a full replace, and this
      // is the one field where null is a deliberate answer rather than a gap.
      const owner = await makeUser("palette-reset");
      const trip = await createTrip(owner.accessToken, "Undo Paint");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const acts = cats.find((c) => c.builtinKey === "ACTIVITIES")!;

      const painted = await http()
        .patch(`/trips/${trip.id}/categories/${acts.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: acts.name,
          singleChoice: acts.singleChoice,
          paletteKey: "VIOLET",
          version: acts.version,
        })
        .expect(200);

      const cleared = await http()
        .patch(`/trips/${trip.id}/categories/${acts.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: acts.name,
          singleChoice: acts.singleChoice,
          paletteKey: null,
          version: painted.body.version,
        })
        .expect(200);
      assert.equal(cleared.body.paletteKey, null);
    });

    it("keeps the colour when the lane is renamed", async () => {
      // The full-replace shape earns its keep here: were the client to drop the
      // field on a rename, the lane would silently lose its colour.
      const owner = await makeUser("palette-rename");
      const trip = await createTrip(owner.accessToken, "Rename Painted");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const stay = cats.find((c) => c.builtinKey === "ACCOMMODATION")!;

      const painted = await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: stay.name,
          singleChoice: stay.singleChoice,
          paletteKey: "ROSE",
          version: stay.version,
        })
        .expect(200);

      const renamed = await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: "Where we sleep",
          singleChoice: stay.singleChoice,
          paletteKey: painted.body.paletteKey,
          version: painted.body.version,
        })
        .expect(200);
      assert.equal(renamed.body.name, "Where we sleep");
      assert.equal(renamed.body.paletteKey, "ROSE");
    });

    it("refuses a palette that is not one of the eight", async () => {
      const owner = await makeUser("palette-bogus");
      const trip = await createTrip(owner.accessToken, "Bad Paint");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const stay = cats.find((c) => c.builtinKey === "ACCOMMODATION")!;

      await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: stay.name,
          singleChoice: stay.singleChoice,
          paletteKey: "CHARTREUSE",
          version: stay.version,
        })
        .expect(400);
    });

    it("lets even Dates be repainted", async () => {
      // The one lane that can be neither deleted nor made multi-select. Its
      // colour is as changeable as any other's, which is why it now has a
      // "⋯" menu at all.
      const owner = await makeUser("palette-dates");
      const trip = await createTrip(owner.accessToken, "Paint Dates");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const dates = cats.find((c) => c.builtinKey === "DATES")!;

      const painted = await http()
        .patch(`/trips/${trip.id}/categories/${dates.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: dates.name,
          singleChoice: true,
          paletteKey: "SKY",
          version: dates.version,
        })
        .expect(200);
      assert.equal(painted.body.paletteKey, "SKY");
    });
  });

  /**
   * The selection mode is now a per-trip choice rather than a per-category
   * guess, so the two rules that bound it are the interesting surface: Dates
   * cannot widen, and nothing can narrow while it would break its own invariant.
   * Both are 409 rather than 403 — an Owner is refused for the same reason
   * anyone else is, because neither is about the caller's role.
   */
  describe("selection mode", () => {
    it("lets an Organizer switch a category to single-choice and back", async () => {
      const owner = await makeUser("mode-owner");
      const trip = await createTrip(owner.accessToken, "Modes");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const stay = cats.find((c) => c.builtinKey === "ACCOMMODATION")!;
      assert.equal(stay.singleChoice, false, "seeded multi-select");

      const narrow = await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: stay.name,
          singleChoice: true,
          paletteKey: null,
          version: stay.version,
        })
        .expect(200);
      assert.equal(narrow.body.singleChoice, true);

      const back = await http()
        .patch(`/trips/${trip.id}/categories/${stay.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: stay.name,
          paletteKey: null,
          singleChoice: false,
          version: narrow.body.version,
        })
        .expect(200);
      assert.equal(back.body.singleChoice, false);
    });

    it("refuses to make Dates multi-select, even for the Owner", async () => {
      const owner = await makeUser("mode-dates");
      const trip = await createTrip(owner.accessToken, "Dates mode");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const dates = cats.find((c) => c.builtinKey === "DATES")!;

      const res = await http()
        .patch(`/trips/${trip.id}/categories/${dates.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: dates.name,
          singleChoice: false,
          paletteKey: null,
          version: dates.version,
        })
        .expect(409);
      assert.match(res.body.message, /one date range/i);
    });

    it("refuses to narrow a category that already has two decisions", async () => {
      const owner = await makeUser("mode-narrow");
      const trip = await createTrip(owner.accessToken, "Narrow");
      const cats = (
        await listCategories(owner.accessToken, trip.id).expect(200)
      ).body as Cat[];
      const acts = cats.find((c) => c.builtinKey === "ACTIVITIES")!;

      // Activities seeds multi-select, so this write re-states the mode rather
      // than changing it. It is kept because the version it bumps is what the
      // narrowing attempt below has to carry — the point of the test is the
      // refusal, not how the lane came to be wide.
      const wide = await http()
        .patch(`/trips/${trip.id}/categories/${acts.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: acts.name,
          singleChoice: false,
          paletteKey: null,
          version: acts.version,
        })
        .expect(200);

      const optionsUrl = `/trips/${trip.id}/categories/${acts.id}/options`;
      const locked: { id: string; version: number }[] = [];
      for (const title of ["Museum", "Beach"]) {
        const opt = await http()
          .post(optionsUrl)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({ title, currency: "EUR" })
          .expect(201);
        await http()
          .post(`${optionsUrl}/${opt.body.id}/lock`)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({ optionVersion: opt.body.version, categoryVersion: 1 })
          .expect(201);
        locked.push({ id: opt.body.id, version: opt.body.version });
      }

      // Narrowing now would leave the category in violation of its own rule,
      // with nobody having chosen which decision survives.
      const refused = await http()
        .patch(`/trips/${trip.id}/categories/${acts.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: acts.name,
          paletteKey: null,
          singleChoice: true,
          version: wide.body.version,
        })
        .expect(409);
      assert.match(refused.body.message, /Unlock all but one/i);

      // Unlock one and it goes through — the message told the caller the truth.
      await http()
        .post(`${optionsUrl}/${locked[0]!.id}/unlock`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ version: locked[0]!.version + 1 })
        .expect(201);

      await http()
        .patch(`/trips/${trip.id}/categories/${acts.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          name: acts.name,
          paletteKey: null,
          singleChoice: true,
          version: wide.body.version,
        })
        .expect(200);
    });
  });

  it("reorders the full set; a partial list is a 400", async () => {
    const owner = await makeUser("reorder-owner");
    const trip = await createTrip(owner.accessToken, "Reorder");
    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    const ids = cats.map((c) => c.id);
    const reversed = [...ids].reverse();

    const res = await http()
      .post(`/trips/${trip.id}/categories/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: reversed })
      .expect(201);
    assert.deepEqual(
      (res.body as Cat[]).map((c) => c.id),
      reversed,
      "positions follow the sent order",
    );

    // A partial set (missing an id) is rejected — reorder must be the full set.
    await http()
      .post(`/trips/${trip.id}/categories/reorder`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ orderedIds: ids.slice(0, 2) })
      .expect(400);
  });

  it("hard-cascade deletes a category (the row is gone)", async () => {
    const owner = await makeUser("delete-owner");
    const trip = await createTrip(owner.accessToken, "Delete");
    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    const victim = cats.find((c) => c.builtinKey === "ACTIVITIES")!;

    await http()
      .delete(`/trips/${trip.id}/categories/${victim.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(204);

    const after = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    assert.ok(
      !after.some((c) => c.id === victim.id),
      "deleted category no longer listed",
    );
    const count = await prisma.category.count({
      where: { id: victim.id },
    });
    assert.equal(count, 0, "row is gone from the DB");
  });

  it("refuses to delete the Dates category, even for the Owner", async () => {
    const owner = await makeUser("dates-owner");
    const trip = await createTrip(owner.accessToken, "Dates guard");
    const cats = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    const dates = cats.find((c) => c.builtinKey === "DATES")!;

    // 409, not 403: the Owner is fully entitled to manage categories — it is
    // this particular category that cannot go, since losing it would strand the
    // trip with no way to set its dates and no way to get one back.
    await http()
      .delete(`/trips/${trip.id}/categories/${dates.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(409);

    const after = (await listCategories(owner.accessToken, trip.id).expect(200))
      .body as Cat[];
    assert.ok(
      after.some((c) => c.id === dates.id),
      "Dates category survives the attempt",
    );
  });

  it("blocks non-Organizers and non-members", async () => {
    const owner = await makeUser("guard-owner");
    const participant = await makeUser("guard-part");
    const stranger = await makeUser("guard-stranger");
    const trip = await createTrip(owner.accessToken, "Guarded Cats");
    await join(
      participant.accessToken,
      await globalLink(owner.accessToken, trip.id, "PARTICIPANT"),
    ).expect(201);

    // A Participant may read the categories (trip.view)…
    await listCategories(participant.accessToken, trip.id).expect(200);
    // …but cannot create one (needs category.manage → 403).
    await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .send({ name: "Nope" })
      .expect(403);

    // A non-member gets a 404 — existence is not leaked.
    await listCategories(stranger.accessToken, trip.id).expect(404);
    await http()
      .post(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ name: "Nope" })
      .expect(404);
  });
});
