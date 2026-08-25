/**
 * The Socket.IO room a **chat** event broadcasts to, which is a subset of the
 * trip's room rather than the same thing.
 *
 * They used to be one room, and that was fine while every member had chat.
 * Post-launch a Guest does not (`message.read`), and a Guest still needs the
 * socket: the board's own live events — a new option, a vote, a lock — go to
 * `tripRoom` and are exactly what the role is for. Refusing the connection
 * would take those away; leaving one room would push every message of a chat
 * they cannot open down the wire to them.
 *
 * So the socket joins the trip room always and this one only when the role
 * holds `message.read`, and the three chat broadcasts address this one.
 */
export function chatRoom(tripId: string): string {
  return `trip:${tripId}:chat`;
}
