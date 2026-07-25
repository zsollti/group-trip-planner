import { z } from "zod";

/**
 * Chat contract (Phase 4.1, SRS §6 / FR-29–32). The shared shapes for the
 * real-time layer. 4.1 lands the channel model and the authenticated socket
 * handshake; messages, reactions, and mentions arrive in 4.2–4.3.
 */

/**
 * A trip's chat channel kind. `GENERAL` is auto-created with the trip; `CATEGORY`
 * channels are created on demand per category (Phase 4.5, FR-29).
 */
export const ChannelType = z.enum(["GENERAL", "CATEGORY"]);
export type ChannelType = z.infer<typeof ChannelType>;

/** A channel as seen by the client. A GENERAL channel has a null `categoryId`. */
export const ChannelView = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  type: ChannelType,
});
export type ChannelView = z.infer<typeof ChannelView>;

/**
 * The handshake payload the client sends when opening a trip socket (Phase 4.1).
 * The access `token` authenticates the connection; `tripId` scopes it to one
 * trip room. **Authorization is re-checked against the DB server-side** (fresh
 * membership + block lookup) and is never trusted from this payload — the same
 * per-request DB-check discipline the REST guards use (SRS FR-4).
 */
export interface TripSocketAuth {
  token: string;
  tripId: string;
}

/**
 * Server → client event emitted once a socket has authenticated and joined its
 * trip room (Phase 4.1). Its payload is the {@link ChannelView} list the member
 * can see (General now; category channels in 4.5). Authentication failures
 * surface through Socket.IO's built-in `connect_error` instead.
 */
export const SOCKET_READY_EVENT = "chat:ready";
