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
 * Invite-links integration test (real DB) — the Phase-1.3 DoD:
 *  - join works for a logged-in redeemer (global + personal);
 *  - the global cap (one active link per role → ≤3/trip) is enforced;
 *  - a personal link is single-use;
 *  - disabling stops new joins but keeps existing members;
 *  - joining is idempotent and a higher-role link upgrades (never downgrades);
 *  - a Co-organizer grant requires a verified email;
 *  - a link may only grant a role below the creator's;
 *  - a History trip refuses new members;
 *  - only Owner/Co-organizer manage invites (non-member → 404, Participant → 403).
 */
describe("Invites (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens_: TokenService;

  const inviteEmails = new Map<string, string>(); // address -> token last emailed
  const suffix = Date.now();
  const emails: string[] = [];

  const http = () => request(app.getHttpServer());

  /** Insert a user directly and mint a valid access token (skips rate limits). */
  async function makeUser(label: string, verified: boolean) {
    const email = `invite+${label}+${suffix}@example.com`;
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

  before(async () => {
    const emailMock = {
      sendVerificationEmail: () => Promise.resolve(),
      sendAccountExistsNotice: () => Promise.resolve(),
      sendInviteEmail: (to: string, token: string) => {
        inviteEmails.set(to, token);
        return Promise.resolve();
      },
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

  it("a global link lets a logged-in user join at the link's role", async () => {
    const owner = await makeUser("g-owner", true);
    const joiner = await makeUser("g-joiner", true);
    const trip = await createTrip(owner.accessToken, "Global Join");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);
    assert.equal(link.body.type, "GLOBAL");
    assert.equal(link.body.role, "PARTICIPANT");
    assert.ok(link.body.token, "a token is issued");

    const joined = await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${joiner.accessToken}`)
      .expect(201);
    assert.equal(joined.body.tripId, trip.id);
    assert.equal(joined.body.role, "PARTICIPANT");
    assert.equal(joined.body.alreadyMember, false);

    // The trip now shows up in the joiner's list as a Participant.
    const list = await http()
      .get("/trips")
      .set("Authorization", `Bearer ${joiner.accessToken}`)
      .expect(200);
    const mine = (list.body as { id: string; role: string }[]).find(
      (t) => t.id === trip.id,
    );
    assert.equal(mine?.role, "PARTICIPANT");
  });

  /**
   * The board, to somebody who has not signed in.
   *
   * The rule being pinned is not "it returns something" — it is the pair of
   * promises the payload makes: everything a visitor needs to decide, and
   * nothing that belongs to the people already on the board. A voter list or an
   * address slipping into this payload is the failure that matters, and it is
   * exactly the kind that a `select` widened by hand introduces silently.
   */
  it("shows the trip behind a link without a session", async () => {
    const owner = await makeUser("prev-owner", true);
    const trip = await createTrip(owner.accessToken, "Preview Trip");

    const cats = await http()
      .get(`/trips/${trip.id}/categories`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    const lane = (cats.body as { id: string; name: string }[])[0]!;
    const option = await http()
      .post(`/trips/${trip.id}/categories/${lane.id}/options`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        title: "A hotel by the sea",
        amount: 120,
        currency: "EUR",
        costType: "PER_PERSON",
      })
      .expect(201);
    await http()
      .post(
        `/trips/${trip.id}/categories/${lane.id}/options/${option.body.id}/votes`,
      )
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);

    // No Authorization header anywhere in this request: that is the feature.
    const res = await http()
      .get(`/join/${link.body.token}/preview`)
      .expect(200);
    const body = res.body as {
      tripId: string;
      name: string;
      memberCount: number;
      acceptingMembers: boolean;
      members: { displayName: string }[];
      lanes: { name: string; options: { title: string; voteCount: number }[] }[];
    };
    assert.equal(body.tripId, trip.id);
    assert.equal(body.name, "Preview Trip");
    assert.equal(body.acceptingMembers, true);
    assert.equal(body.memberCount, 1);
    assert.equal(body.members[0]?.displayName, "prev-owner");
    const shown = body.lanes.find((l) => l.name === lane.name);
    assert.equal(shown?.options[0]?.title, "A hotel by the sea");
    // The tally is a fact about the option, so it is here.
    assert.equal(shown?.options[0]?.voteCount, 1);

    // And nothing that belongs to the people already on the board. Asserted
    // against the serialized payload rather than field by field, because the
    // risk is a field nobody thought to look for.
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(owner.email), "no member addresses");
    assert.ok(!raw.includes("voters"), "no voter list");
    assert.ok(!raw.includes("budgetPerPerson"), "no budget");
    assert.ok(!raw.includes("passwordHash"), "no credentials");
  });

  it("shows nothing once the link is dead", async () => {
    const owner = await makeUser("prev-dead", true);
    const trip = await createTrip(owner.accessToken, "Revoked Preview");
    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);

    await http().get(`/join/${link.body.token}/preview`).expect(200);

    await http()
      .delete(`/trips/${trip.id}/invites/${link.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);

    // A revoked link that went on being a window into the trip would make
    // "disable" a lie about the only thing it controls.
    await http().get(`/join/${link.body.token}/preview`).expect(410);
    await http().get("/join/not-a-real-token/preview").expect(404);
  });

  it("enforces one active global link per role (cap), across roles up to 3", async () => {
    const owner = await makeUser("cap-owner", true);
    const trip = await createTrip(owner.accessToken, "Cap Trip");
    const mk = (role: string) =>
      http()
        .post(`/trips/${trip.id}/invites`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ type: "GLOBAL", role });

    await mk("PARTICIPANT").expect(201);
    // Second active global for the same role is rejected.
    await mk("PARTICIPANT").expect(409);
    // Different roles are allowed (Owner may grant Co-organizer).
    await mk("GUEST").expect(201);
    await mk("CO_ORGANIZER").expect(201);
  });

  it("a personal link is single-use", async () => {
    const owner = await makeUser("p-owner", true);
    const first = await makeUser("p-first", true);
    const second = await makeUser("p-second", true);
    const trip = await createTrip(owner.accessToken, "Personal Trip");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "PERSONAL", role: "PARTICIPANT", email: first.email })
      .expect(201);
    assert.equal(link.body.sentToEmail, first.email);
    assert.equal(inviteEmails.get(first.email), link.body.token);

    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${first.accessToken}`)
      .expect(201);

    // The link is now consumed — a second person cannot redeem it.
    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${second.accessToken}`)
      .expect(410);
  });

  it("disabling a link stops new joins but keeps existing members", async () => {
    const owner = await makeUser("d-owner", true);
    const early = await makeUser("d-early", true);
    const late = await makeUser("d-late", true);
    const trip = await createTrip(owner.accessToken, "Disable Trip");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);

    // Early joiner gets in while the link is live.
    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${early.accessToken}`)
      .expect(201);

    // Owner disables the link.
    const disabled = await http()
      .delete(`/trips/${trip.id}/invites/${link.body.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(200);
    assert.ok(disabled.body.disabledAt, "the link is marked disabled");

    // A late arrival can no longer join…
    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${late.accessToken}`)
      .expect(410);

    // …but the early member is retained.
    const early_still = await http()
      .get(`/trips/${trip.id}`)
      .set("Authorization", `Bearer ${early.accessToken}`)
      .expect(200);
    assert.equal(early_still.body.role, "PARTICIPANT");
  });

  it("joining is idempotent and a higher-role link upgrades (never downgrades)", async () => {
    const owner = await makeUser("u-owner", true);
    const member = await makeUser("u-member", true);
    const trip = await createTrip(owner.accessToken, "Upgrade Trip");

    const guestLink = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "GUEST" })
      .expect(201);
    const partLink = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);

    // First join as Guest.
    const asGuest = await http()
      .post(`/join/${guestLink.body.token}`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .expect(201);
    assert.equal(asGuest.body.role, "GUEST");
    assert.equal(asGuest.body.alreadyMember, false);

    // Redeeming the Participant link upgrades them.
    const upgraded = await http()
      .post(`/join/${partLink.body.token}`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .expect(201);
    assert.equal(upgraded.body.role, "PARTICIPANT");
    assert.equal(upgraded.body.alreadyMember, true);

    // Redeeming the lower Guest link again does NOT downgrade (idempotent NOOP).
    const noDown = await http()
      .post(`/join/${guestLink.body.token}`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .expect(201);
    assert.equal(noDown.body.role, "PARTICIPANT");

    // Exactly one membership row exists for this member.
    const count = await prisma.tripMembership.count({
      where: { tripId: trip.id, userId: member.user.id },
    });
    assert.equal(count, 1, "join never duplicates a membership");
  });

  it("a Co-organizer grant requires a verified email", async () => {
    const owner = await makeUser("v-owner", true);
    const unverified = await makeUser("v-unverified", false);
    const verified = await makeUser("v-verified", true);
    const trip = await createTrip(owner.accessToken, "Coorg Gate");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "CO_ORGANIZER" })
      .expect(201);

    // Unverified user cannot accept a Co-organizer grant.
    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${unverified.accessToken}`)
      .expect(403);

    // A verified user can.
    const ok = await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${verified.accessToken}`)
      .expect(201);
    assert.equal(ok.body.role, "CO_ORGANIZER");
  });

  it("a link may only grant a role below the creator's own", async () => {
    const owner = await makeUser("s-owner", true);
    const coorg = await makeUser("s-coorg", true);
    const trip = await createTrip(owner.accessToken, "Strictly Lower");

    // Owner promotes coorg via a Co-organizer link.
    const coorgLink = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "CO_ORGANIZER" })
      .expect(201);
    await http()
      .post(`/join/${coorgLink.body.token}`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .expect(201);

    // A Co-organizer may create Participant/Guest links…
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);
    // …but NOT a peer Co-organizer link. The address is here because a
    // personal link now requires one and the validation pipe runs first — the
    // rule under test is the role rank, and a 400 for a missing field would
    // pass this assertion without ever reaching it.
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({
        type: "PERSONAL",
        role: "CO_ORGANIZER",
        email: "peer@example.com",
      })
      .expect(403);
  });

  it("binds a personal link to the address it was sent to", async () => {
    const owner = await makeUser("b-owner", true);
    const invited = await makeUser("b-invited", true);
    const other = await makeUser("b-other", true);
    const trip = await createTrip(owner.accessToken, "Bound Trip");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      // Capitalised on purpose: a domain is not case-sensitive and nobody
      // types their own capitalisation consistently, so a link that works only
      // for the exact casing the inviter used is a link that mostly does not.
      .send({
        type: "PERSONAL",
        role: "PARTICIPANT",
        email: invited.email.toUpperCase(),
      })
      .expect(201);

    // Somebody else holding the URL — forwarded, pasted into a group chat,
    // read out of a shared inbox. Single-use never covered this; it only
    // decided which stranger got in.
    const refused = await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${other.accessToken}`)
      .expect(403);
    // And it names the address, because the commonest way to hit this is not
    // an attack: it is being invited at one address and signed in with
    // another, where "no" without "try this account" is a dead end.
    assert.match(String(refused.body.message), /b-invited/i);

    // The refusal leaves the link alone — not consumed, still redeemable by
    // the person it was actually for.
    const joined = await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${invited.accessToken}`)
      .expect(201);
    assert.equal(joined.body.role, "PARTICIPANT");
  });

  it("refuses a personal link with nobody to send it to", async () => {
    const owner = await makeUser("n-owner", true);
    const trip = await createTrip(owner.accessToken, "Unaddressed");
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "PERSONAL", role: "PARTICIPANT" })
      .expect(400);
    // A global link is broadcast by definition and needs none.
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);
  });

  it("lets a link written before binding stay open", async () => {
    // Links are sitting in inboxes right now, sent by people who had no way to
    // know this rule was coming. The bar is for every link written from here
    // on; refusing the ones already out there breaks a promise the app made.
    const owner = await makeUser("l-owner", true);
    const anyone = await makeUser("l-anyone", true);
    const trip = await createTrip(owner.accessToken, "Legacy Link");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        type: "PERSONAL",
        role: "PARTICIPANT",
        email: "someone@example.com",
      })
      .expect(201);
    // Reach behind the contract to make the row look like an old one: the
    // schema will not write this shape any more, which is the whole point.
    await prisma.inviteLink.update({
      where: { id: link.body.id },
      data: { sentToEmail: null },
    });

    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${anyone.accessToken}`)
      .expect(201);
  });

  it("a History trip refuses new members", async () => {
    const owner = await makeUser("h-owner", true);
    const joiner = await makeUser("h-joiner", true);
    const trip = await createTrip(owner.accessToken, "Old Trip");

    const link = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);

    // Force the trip into History (the lifecycle transition itself is Phase 2).
    await prisma.trip.update({
      where: { id: trip.id },
      data: { status: "HISTORY" },
    });

    await http()
      .post(`/join/${link.body.token}`)
      .set("Authorization", `Bearer ${joiner.accessToken}`)
      .expect(403);
  });

  it("only Owner/Co-organizer manage invites (non-member 404, Participant 403)", async () => {
    const owner = await makeUser("m-owner", true);
    const participant = await makeUser("m-participant", true);
    const stranger = await makeUser("m-stranger", true);
    const trip = await createTrip(owner.accessToken, "Managed Trip");

    const partLink = await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ type: "GLOBAL", role: "PARTICIPANT" })
      .expect(201);
    await http()
      .post(`/join/${partLink.body.token}`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .expect(201);

    // A Participant is a member but lacks invite.create → 403.
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .send({ type: "GLOBAL", role: "GUEST" })
      .expect(403);
    await http()
      .get(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${participant.accessToken}`)
      .expect(403);

    // A non-member gets a 404 (existence not leaked), not a 403.
    await http()
      .get(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .expect(404);
  });
});
