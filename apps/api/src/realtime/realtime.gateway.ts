import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server } from "socket.io";
import { tripRoom } from "./trip-room.js";

/**
 * A thin server→client emitter for non-chat services (Phase 4.5). It is a second
 * `@WebSocketGateway` that shares the **same** underlying Socket.IO server (Nest
 * injects the one root server into every gateway's `@WebSocketServer()`), so it
 * broadcasts into the exact rooms {@link ChatGateway} joined sockets to — without
 * the options/categories modules having to depend on the chat module.
 *
 * It handles no inbound events: authentication, the room join, and the message
 * protocol all live on {@link ChatGateway}. This class only *pushes* — the
 * retrofit that makes locks and new options appear live for every trip viewer
 * (FR-29). Emits are best-effort and null-safe: in a test that never calls
 * `app.listen()` the server isn't attached, and a broadcast is simply a no-op, so
 * the pure/e2e option tests are unaffected.
 */
@WebSocketGateway()
export class RealtimeGateway {
  @WebSocketServer() private readonly server?: Server;

  /** Broadcast an event to everyone currently viewing a trip. */
  emitToTrip(tripId: string, event: string, payload: unknown): void {
    this.server?.to(tripRoom(tripId)).emit(event, payload);
  }
}
