import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_READY_EVENT, type ChannelView } from "@gtp/types";
import { getAccessToken, getApiBaseUrl, refreshAccessToken } from "./http.js";

/**
 * Trip socket lifecycle (Phase 4.1). One connection per open trip.
 *
 * - `connecting` while the handshake/reconnect is in flight,
 * - `connected` once authenticated and joined to the trip room,
 * - `error` once the connection is rejected and a token refresh didn't help.
 */
export type SocketStatus = "idle" | "connecting" | "connected" | "error";

export interface TripSocket {
  status: SocketStatus;
  /** The channels the member can see, from the server's ready payload. */
  channels: ChannelView[];
  /** The live socket (null until connecting) — 4.2+ send/receive over this. */
  socket: Socket | null;
}

/**
 * Open an authenticated socket to the trip room for the lifetime of the trip
 * screen (Phase 4.1). The in-memory access token authenticates the handshake;
 * if it's rejected (commonly an expired token) we refresh **once** via the
 * cookie and reconnect, mirroring the REST 401-refresh-and-retry. Socket.IO's
 * own bounded reconnection covers transient drops — the full missed-message
 * recovery story lands in 4.4. The socket disconnects and cleans up on unmount
 * or a `tripId` change.
 */
export function useTripSocket(tripId: string | undefined): TripSocket {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!tripId) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    let triedRefresh = false;

    const socket = io(getApiBaseUrl(), {
      auth: { token: getAccessToken() ?? "", tripId },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;
    setStatus("connecting");

    socket.on("connect", () => {
      if (!cancelled) setStatus("connected");
    });
    socket.on("disconnect", () => {
      // A drop starts Socket.IO's own reconnection; reflect that as connecting.
      if (!cancelled) setStatus("connecting");
    });
    socket.on(SOCKET_READY_EVENT, (list: ChannelView[]) => {
      if (!cancelled) setChannels(list);
    });
    socket.on("connect_error", () => {
      void (async () => {
        if (triedRefresh) {
          if (!cancelled) setStatus("error");
          return;
        }
        triedRefresh = true;
        const refreshed = await refreshAccessToken();
        if (cancelled) return;
        if (refreshed) {
          socket.auth = { token: getAccessToken() ?? "", tripId };
          socket.connect();
        } else {
          setStatus("error");
        }
      })();
    });

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setStatus("idle");
    };
  }, [tripId]);

  return { status, channels, socket: socketRef.current };
}
