import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { SOCKET_READY_EVENT } from "@gtp/types";
import { PrismaService } from "../prisma/prisma.service.js";
import { ChannelsService } from "./channels.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the gateway pins on an authenticated socket after the handshake. */
interface SocketData {
  userId: string;
  tripId: string;
}

/** The Socket.IO room every event for a trip broadcasts to. Server-internal:
 * a socket is placed in exactly one trip room, and only after the membership
 * check passes — the isolation boundary that keeps a trip's traffic private. */
export function tripRoom(tripId: string): string {
  return `trip:${tripId}`;
}

/**
 * The per-trip real-time gateway (Phase 4.1). One Socket.IO connection per open
 * trip. Authentication + authorization run in a connection **middleware** so an
 * unauthorized socket is rejected *during* the handshake (the client sees
 * `connect_error`), never connected-then-dropped. The discipline mirrors the
 * REST guards exactly: verify the access token, load the user fresh from the DB,
 * then confirm trip membership and the absence of a block — the role/block is a
 * DB check, never trusted from the handshake payload (SRS FR-4). Only then does
 * the socket join its single trip room. Messages/reactions land in 4.2–4.3.
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  afterInit(server: Server): void {
    // Reject unauthorized sockets at the handshake, before `connection` fires.
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as Partial<SocketData>;
    // The middleware only calls next() after pinning both; this is defensive.
    if (!data.userId || !data.tripId) {
      client.disconnect(true);
      return;
    }
    await client.join(tripRoom(data.tripId));
    const channels = await this.channels.listForTrip(data.tripId);
    client.emit(SOCKET_READY_EVENT, channels);
    this.logger.debug(`socket joined ${tripRoom(data.tripId)}`);
  }

  /**
   * Handshake gate. Throws on any failure so the connection middleware rejects
   * the socket; on success pins `{ userId, tripId }` for the room join above.
   */
  private async authenticate(client: Socket): Promise<void> {
    const auth = client.handshake.auth as { token?: unknown; tripId?: unknown };
    const token = typeof auth.token === "string" ? auth.token : "";
    const tripId = typeof auth.tripId === "string" ? auth.tripId : "";
    if (!token || !UUID_RE.test(tripId)) throw new Error("unauthorized");

    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      sub = payload.sub;
    } catch {
      throw new Error("unauthorized");
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.anonymizedAt) throw new Error("unauthorized");

    const membership = await this.prisma.tripMembership.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
    });
    // Non-members are refused: a socket never joins a trip it isn't part of.
    if (!membership) throw new Error("forbidden");

    // A block ejects membership already, so this is belt-and-suspenders — but it
    // keeps the socket gate honest to FR-17 independent of the membership row.
    const block = await this.prisma.tripBlock.findUnique({
      where: { tripId_userId: { tripId, userId: user.id } },
    });
    if (block) throw new Error("forbidden");

    (client.data as SocketData) = { userId: user.id, tripId };
  }
}
