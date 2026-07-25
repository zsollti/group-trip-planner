import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  MESSAGE_DELETE_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_NEW_EVENT,
  MESSAGE_SEND_EVENT,
  type MessageAck,
  type MessagePage,
  type MessageView,
  SOCKET_READY_EVENT,
  type ChannelView,
} from "@gtp/types";
import {
  apiFetch,
  getAccessToken,
  getApiBaseUrl,
  refreshAccessToken,
} from "./http.js";

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

/** A message in the chat panel: a {@link MessageView} plus optimistic UI flags
 * while a locally-composed message is in flight (before the server ack). */
export interface ChatMessage extends MessageView {
  /** True for a locally-composed message awaiting the server ack. */
  pending?: boolean;
  /** True if the send was rejected/timed out — shown with a retry affordance. */
  failed?: boolean;
}

export interface ChatController {
  messages: ChatMessage[];
  status: "loading" | "ready" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  send: (body: string) => void;
  remove: (messageId: string) => void;
}

let tempCounter = 0;

/**
 * The chat panel controller (Phase 4.2). Loads cursor-paged history over REST,
 * then keeps the channel live over the shared trip `socket`:
 *  - **send** appends an optimistic message immediately, emits with an ack, and
 *    reconciles the temp copy with the stored message (or flags it failed on a
 *    rejection/timeout — a dropped message never looks sent);
 *  - **incoming** `message:new` for this channel appends (deduped by id);
 *  - **delete** emits; the server tombstones and broadcasts `message:deleted`
 *    to the whole room, which flips the message to a tombstone in place.
 *
 * `messages` is ordered oldest → newest for display. Passing the socket in (from
 * {@link useTripSocket}) keeps one connection per trip shared with the indicator.
 */
export function useChat(
  socket: Socket | null,
  tripId: string,
  channelId: string | undefined,
): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | null>(null);

  const upsert = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === incoming.id);
      if (i === -1) return [...prev, incoming];
      const next = [...prev];
      next[i] = incoming;
      return next;
    });
  }, []);

  // Initial history load (newest page). Reset when the channel changes.
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setStatus("loading");
    setMessages([]);
    apiFetch<MessagePage>(`/trips/${tripId}/channels/${channelId}/messages`)
      .then((page) => {
        if (cancelled) return;
        // History comes newest-first; display oldest-first.
        setMessages([...page.messages].reverse());
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, channelId]);

  // Live stream: new + deleted broadcasts for this channel.
  useEffect(() => {
    if (!socket || !channelId) return;
    const onNew = (msg: MessageView) => {
      if (msg.channelId === channelId) upsert(msg);
    };
    const onDeleted = (msg: MessageView) => {
      if (msg.channelId === channelId) upsert(msg);
    };
    socket.on(MESSAGE_NEW_EVENT, onNew);
    socket.on(MESSAGE_DELETED_EVENT, onDeleted);
    return () => {
      socket.off(MESSAGE_NEW_EVENT, onNew);
      socket.off(MESSAGE_DELETED_EVENT, onDeleted);
    };
  }, [socket, channelId, upsert]);

  const send = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!socket || !channelId || !text) return;
      const tempId = `temp-${Date.now()}-${tempCounter++}`;
      const optimistic: ChatMessage = {
        id: tempId,
        channelId,
        authorId: "self",
        authorName: "You",
        body: text,
        deleted: false,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      socket
        .timeout(10_000)
        .emit(
          MESSAGE_SEND_EVENT,
          { channelId, body: text },
          (err: Error | null, ack?: MessageAck) => {
            if (!err && ack?.ok) {
              // Swap the temp message for the stored one (keeps ordering).
              setMessages((prev) =>
                prev.map((m) => (m.id === tempId ? ack.message : m)),
              );
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempId ? { ...m, pending: false, failed: true } : m,
                ),
              );
            }
          },
        );
    },
    [socket, channelId],
  );

  const remove = useCallback(
    (messageId: string) => {
      if (!socket) return;
      // The server broadcasts the tombstone to the whole room (incl. us).
      socket.emit(MESSAGE_DELETE_EVENT, { messageId });
    },
    [socket],
  );

  const loadOlder = useCallback(() => {
    const cursor = cursorRef.current;
    if (!channelId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    apiFetch<MessagePage>(
      `/trips/${tripId}/channels/${channelId}/messages?cursor=${encodeURIComponent(cursor)}`,
    )
      .then((page) => {
        // Older page is newest-first; prepend oldest-first, dedup by id.
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const older = [...page.messages]
            .reverse()
            .filter((m) => !known.has(m.id));
          return [...older, ...prev];
        });
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
      })
      .finally(() => setLoadingOlder(false));
  }, [tripId, channelId, loadingOlder]);

  return {
    messages,
    status,
    hasMore: nextCursor !== null,
    loadingOlder,
    loadOlder,
    send,
    remove,
  };
}
