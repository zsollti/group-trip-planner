import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io } from "socket.io-client";
import { SOCKET_READY_EVENT, type ChannelView } from "@gtp/types";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { TripsService } from "../src/trips/trips.service.js";

/**
 * Chat WebSocket gateway integration test (real DB + a real Socket.IO client).
 * Covers the Phase-4.1 DoD:
 * - a verified member's socket authenticates, joins the trip room, and receives
 *   the ready payload (its General channel);
 * - a non-member socket is rejected (the IDOR surface — never joins a trip it
 *   isn't part of);
 * - a blocked member's socket is rejected even with a valid token;
 * - a garbage token is rejected;
 * - creating a trip auto-provisions its General channel.
 */
describe("Chat gateway (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;
  let port: number;
  const suffix = Date.now();
  const userIds: string[] = [];
  const tripIds: string[] = [];

  async function makeUser(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `chat+${label}+${suffix}@example.com`,
        displayName: label,
        emailVerified: true,
      },
    });
    userIds.push(user.id);
    const token = await tokens.signAccessToken(user);
    return { user, token };
  }

  /** A trip owned by `ownerId`, with the owner's membership + a General channel
   * (mirrors createTrip minimally, without seeding categories). */
  async function makeTrip(ownerId: string) {
    const trip = await prisma.trip.create({
      data: {
        name: `Trip ${suffix}`,
        defaultCurrency: "EUR",
        expiresAt: new Date(Date.now() + 86_400_000),
        ownerId,
      },
    });
    tripIds.push(trip.id);
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: ownerId, role: "OWNER" },
    });
    await prisma.channel.create({ data: { tripId: trip.id, type: "GENERAL" } });
    return trip;
  }

  /** Attempt a handshake; resolve with the ready payload or the rejection message. */
  function attempt(auth: {
    token: string;
    tripId: string;
  }): Promise<
    { ok: true; channels: ChannelView[] } | { ok: false; message: string }
  > {
    return new Promise((resolve) => {
      const socket = io(`http://localhost:${port}`, {
        auth,
        transports: ["websocket"],
        reconnection: false,
      });
      socket.on(SOCKET_READY_EVENT, (channels: ChannelView[]) => {
        socket.disconnect();
        resolve({ ok: true, channels });
      });
      socket.on("connect_error", (err: Error) => {
        socket.disconnect();
        resolve({ ok: false, message: err.message });
      });
    });
  }

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    // A real port so the Socket.IO server attaches and a client can connect.
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  after(async () => {
    // Trips cascade their memberships, channels, and blocks.
    for (const id of tripIds)
      await prisma.trip.deleteMany({ where: { id } }).catch(() => undefined);
    for (const id of userIds)
      await prisma.user.deleteMany({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it("lets a member join and delivers the General channel", async () => {
    const owner = await makeUser("member");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: owner.token, tripId: trip.id });
    assert.ok(result.ok, "member socket should connect");
    assert.equal(result.channels.length, 1);
    assert.equal(result.channels[0]?.type, "GENERAL");
    assert.equal(result.channels[0]?.tripId, trip.id);
  });

  it("rejects a non-member socket (never joins a trip it isn't part of)", async () => {
    const owner = await makeUser("owner2");
    const outsider = await makeUser("outsider");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: outsider.token, tripId: trip.id });
    assert.equal(result.ok, false);
  });

  it("rejects a blocked member even with a valid token", async () => {
    const owner = await makeUser("owner3");
    const blocked = await makeUser("blocked");
    const trip = await makeTrip(owner.user.id);
    // A membership row AND a block row — the block must win.
    await prisma.tripMembership.create({
      data: { tripId: trip.id, userId: blocked.user.id, role: "PARTICIPANT" },
    });
    await prisma.tripBlock.create({
      data: {
        tripId: trip.id,
        userId: blocked.user.id,
        blockedById: owner.user.id,
      },
    });

    const result = await attempt({ token: blocked.token, tripId: trip.id });
    assert.equal(result.ok, false);
  });

  it("rejects a garbage token", async () => {
    const owner = await makeUser("owner4");
    const trip = await makeTrip(owner.user.id);

    const result = await attempt({ token: "not-a-jwt", tripId: trip.id });
    assert.equal(result.ok, false);
  });

  it("auto-creates a General channel when a trip is created", async () => {
    const creator = await makeUser("creator");
    const detail = await app
      .get(TripsService)
      .createTrip(creator.user, { name: "Auto trip", defaultCurrency: "EUR" });
    tripIds.push(detail.id);

    const channels = await prisma.channel.findMany({
      where: { tripId: detail.id },
    });
    assert.equal(channels.length, 1);
    assert.equal(channels[0]?.type, "GENERAL");
  });
});
