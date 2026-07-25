/**
 * The Socket.IO room every event for a trip broadcasts to (Phase 4.1). Server-
 * internal: a socket is placed in exactly one trip room, and only after the
 * membership check passes — the isolation boundary that keeps a trip's traffic
 * private. Shared by the chat gateway (which joins sockets to it) and the
 * realtime gateway (which non-chat services use to push into it).
 */
export function tripRoom(tripId: string): string {
  return `trip:${tripId}`;
}
