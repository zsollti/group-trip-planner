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
    // …but NOT a peer Co-organizer link.
    await http()
      .post(`/trips/${trip.id}/invites`)
      .set("Authorization", `Bearer ${coorg.accessToken}`)
      .send({ type: "PERSONAL", role: "CO_ORGANIZER" })
      .expect(403);
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
