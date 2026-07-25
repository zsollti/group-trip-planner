/**
 * The Socket.IO room that carries a **person's** events rather than a trip's
 * (Phase 5.1, decision 1). Every authenticated socket joins its owner's personal
 * room in addition to the trip room, so a notification about trip B reaches a
 * member who currently has trip A open — the bell is live across trips, not only
 * inside the trip that caused it.
 *
 * The room name is derived from the **server-verified** user id pinned during the
 * handshake, never from anything the client sends, so one user's socket can never
 * land in another's room.
 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
