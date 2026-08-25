import { createContext, useContext, type ReactNode } from "react";
import { useAuth, useUserSocket } from "@gtp/api-client";
import type { SessionSocket } from "@gtp/api-client";

/**
 * The session's one socket, held above the routes.
 *
 * It used to be opened by the trip screen and torn down when you left it, which
 * is what made a conversation a property of the page you were standing on. Held
 * here it outlives navigation: the chat dock can offer every board's chat from
 * anywhere in the app, and moving between boards no longer costs a handshake.
 *
 * **Mounted for everyone, connected only when signed in.** The provider itself
 * is unconditional so the tree shape does not change at sign-in — a provider
 * that appeared and disappeared would remount everything under it — and the
 * hook takes `enabled` instead, which is the thing that actually differs.
 *
 * Deliberately nothing else. Keeping the server's rooms in step with a
 * membership that moves needs the reader's trip list, and the dock is already
 * holding that to put names on the conversations; asking for it here as well
 * would be a second copy of the same query living a layer higher than anything
 * that reads it.
 */
const SessionSocketContext = createContext<SessionSocket | null>(null);

export function SessionSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socket = useUserSocket(Boolean(user));
  return (
    <SessionSocketContext.Provider value={socket}>
      {children}
    </SessionSocketContext.Provider>
  );
}

/**
 * The session's socket.
 *
 * Throws rather than returning null for a caller outside the provider: every
 * surface that wants this is inside the app shell, so an absent provider is a
 * wiring mistake to catch in a test, not a state to render around.
 */
export function useSessionSocket(): SessionSocket {
  const value = useContext(SessionSocketContext);
  if (!value) {
    throw new Error(
      "useSessionSocket must be used inside SessionSocketProvider",
    );
  }
  return value;
}
