import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import {
  CHANNEL_CREATED_EVENT,
  ROOMS_REFRESH_EVENT,
  MESSAGE_DELETE_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_NEW_EVENT,
  MESSAGE_SEND_EVENT,
  type MessageAck,
  type MessagePage,
  type MessageView,
  OPTIONS_CHANGED_EVENT,
  type OptionsChanged,
  REACTION_ADD_EVENT,
  REACTION_REMOVE_EVENT,
  REACTION_UPDATED_EVENT,
  type ReactionUpdate,
  SOCKET_READY_EVENT,
  type ChannelView,
  type ChatReadyPayload,
} from "@gtp/types";
import {
  apiFetch,
  getAccessToken,
  getApiBaseUrl,
  refreshAccessToken,
} from "./http.js";
import { optionKeys } from "./options.js";
import { categoryKeys } from "./categories.js";
import { dashboardKeys } from "./dashboard.js";
import { tripKeys } from "./trips.js";

/**
 * Trip socket lifecycle (Phase 4.1). One connection per open trip.
 *
 * - `connecting` while the handshake/reconnect is in flight,
 * - `connected` once authenticated and joined to the trip room,
 * - `error` once the connection is rejected and a token refresh didn't help.
 */
export type SocketStatus = "idle" | "connecting" | "connected" | "error";

/**
 * The live socket, re-exported so apps can type a socket prop without importing
 * `socket.io-client` themselves. This package owns the transport dependency —
 * an app that reaches past it type-checks locally on a hoisted install and then
 * fails on a clean one.
 */
export type LiveSocket = Socket;

export interface SessionSocket {
  status: SocketStatus;
  /**
   * Every channel the reader can see, across every board they are on.
   *
   * It used to be one trip's worth, because the socket was one trip's worth.
   * Each carries its own `tripId`, which is what lets a caller that only cares
   * about one board filter for it — and what lets the dock group them.
   */
  channels: ChannelView[];
  /** Per-channel unread counts (channelId → count), live and cross-trip. */
  unread: Record<string, number>;
  /** The live socket (null until connecting) — 4.2+ send/receive over this. */
  socket: Socket | null;
  /** Mark a channel read: clears its unread badge + advances the server cursor. */
  markChannelRead: (channelId: string) => void;
  /** Set the channel the user is currently viewing (null when none): live
   * messages for it don't bump unread, and it is marked read on focus. */
  setActiveChannel: (channelId: string | null) => void;
  /**
   * Re-run the server's room join, after this session's membership has moved.
   *
   * The rooms a connection can hear are decided when it connects, and a
   * session-long connection outlives joining a board or being removed from one.
   * A per-trip socket never needed this: navigating re-handshook it.
   */
  refreshRooms: () => void;
}

/**
 * One authenticated socket for the whole signed-in session.
 *
 * It was one per open trip, which made a conversation a property of the page
 * you were standing on. The handshake carries only the access token now; the
 * server joins the rooms of every board this reader belongs to and answers with
 * all of their channels and unread counts at once.
 *
 * If the token is rejected — commonly because it expired — we refresh **once**
 * via the cookie and reconnect, mirroring the REST 401-refresh-and-retry.
 * Socket.IO's own bounded reconnection covers transient drops, and the server
 * re-sends the ready payload on each one, so unread counts are never stale for
 * longer than a reconnect.
 *
 * Mounted once, above the routes: the effect has no dependencies, so navigating
 * between boards no longer tears a connection down and builds another.
 */
export function useUserSocket(enabled: boolean): SessionSocket {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const socketRef = useRef<Socket | null>(null);
  const activeChannelRef = useRef<string | null>(null);
  /**
   * Which board each channel is on, for the read-cursor call.
   *
   * The route is `/trips/:tripId/channels/:channelId/read` and the caller only
   * has a channel id — it used to have the trip because the whole hook did. A
   * ref rather than reading `channels` directly, so `markChannelRead` keeps a
   * stable identity: it is a dependency of `setActiveChannel`, which the panel
   * calls from an effect.
   */
  const tripOfChannel = useRef(new Map<string, string>());

  const markChannelRead = useCallback((channelId: string) => {
    setUnread((u) => ({ ...u, [channelId]: 0 }));
    const tripId = tripOfChannel.current.get(channelId);
    if (!tripId) return;
    void apiFetch(`/trips/${tripId}/channels/${channelId}/read`, {
      method: "POST",
    }).catch(() => undefined);
  }, []);

  const setActiveChannel = useCallback(
    (channelId: string | null) => {
      activeChannelRef.current = channelId;
      if (channelId) markChannelRead(channelId);
    },
    [markChannelRead],
  );

  const refreshRooms = useCallback(() => {
    socketRef.current?.emit(ROOMS_REFRESH_EVENT);
  }, []);

  // Every channel the session knows about, indexed by the board it is on. Kept
  // in step with `channels` rather than derived at call time, because the
  // callback that reads it must not change identity when a message arrives.
  useEffect(() => {
    tripOfChannel.current = new Map(channels.map((c) => [c.id, c.tripId]));
  }, [channels]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setChannels([]);
      setUnread({});
      return;
    }
    let cancelled = false;
    let triedRefresh = false;

    const socket = io(getApiBaseUrl(), {
      auth: { token: getAccessToken() ?? "" },
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
    socket.on(SOCKET_READY_EVENT, (payload: ChatReadyPayload) => {
      if (cancelled) return;
      setChannels(payload.channels);
      // Seed unread, but keep the channel the user is viewing at zero.
      const seeded: Record<string, number> = {};
      for (const u of payload.unread) {
        seeded[u.channelId] =
          u.channelId === activeChannelRef.current ? 0 : u.count;
      }
      setUnread(seeded);
    });
    socket.on(MESSAGE_NEW_EVENT, (msg: MessageView) => {
      if (cancelled) return;
      // Every message moves its channel's `lastMessageAt`, including one in the
      // channel being read and including your own: the switcher orders on this,
      // and an order that ignored the conversation in front of you would put it
      // back at the bottom the next time it re-sorted.
      setChannels((prev) =>
        prev.map((c) =>
          c.id === msg.channelId ? { ...c, lastMessageAt: msg.createdAt } : c,
        ),
      );
      if (msg.channelId === activeChannelRef.current) return;
      setUnread((u) => ({
        ...u,
        [msg.channelId]: (u[msg.channelId] ?? 0) + 1,
      }));
    });
    // A member started a category discussion (Phase 4.5): add its channel live so
    // it appears in the switcher for everyone, not just the member who opened it.
    socket.on(CHANNEL_CREATED_EVENT, (channel: ChannelView) => {
      if (cancelled) return;
      setChannels((prev) =>
        prev.some((c) => c.id === channel.id) ? prev : [...prev, channel],
      );
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
          socket.auth = { token: getAccessToken() ?? "" };
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
  }, [enabled]);

  return {
    status,
    channels,
    unread,
    socket: socketRef.current,
    markChannelRead,
    setActiveChannel,
    refreshRooms,
  };
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
  /** Re-run the history load — the way out of the `error` status. */
  reload: () => void;
  send: (body: string) => void;
  remove: (messageId: string) => void;
  /** Toggle the viewer's reaction with `emoji` on a message (optimistic). */
  toggleReaction: (messageId: string, emoji: string) => void;
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
 * `messages` is ordered oldest → newest for display. The socket is passed in
 * (from {@link useUserSocket}) — one connection for the session, shared with the
 * indicator and every other channel. That sharing is why the live handlers below
 * filter on `channelId`: this controller now hears traffic from every board the
 * reader is on, and only one channel of it is the one on screen.
 */
export function useChat(
  socket: Socket | null,
  tripId: string,
  channelId: string | undefined,
  myUserId: string | undefined,
): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursorRef = useRef<string | null>(null);
  // Bumping this re-runs the history load; it is what `reload()` drives.
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [tripId, channelId, reloadKey]);

  // Live stream: new + deleted broadcasts for this channel.
  useEffect(() => {
    if (!socket || !channelId) return;
    const onNew = (msg: MessageView) => {
      if (msg.channelId === channelId) upsert(msg);
    };
    const onDeleted = (msg: MessageView) => {
      if (msg.channelId === channelId) upsert(msg);
    };
    const onReaction = (update: ReactionUpdate) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === update.messageId ? { ...m, reactions: update.reactions } : m,
        ),
      );
    };
    socket.on(MESSAGE_NEW_EVENT, onNew);
    socket.on(MESSAGE_DELETED_EVENT, onDeleted);
    socket.on(REACTION_UPDATED_EVENT, onReaction);
    return () => {
      socket.off(MESSAGE_NEW_EVENT, onNew);
      socket.off(MESSAGE_DELETED_EVENT, onDeleted);
      socket.off(REACTION_UPDATED_EVENT, onReaction);
    };
  }, [socket, channelId, upsert]);

  // Track the newest confirmed message id for reconnect catch-up.
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && !m.pending && !m.failed) {
        lastIdRef.current = m.id;
        break;
      }
    }
  }, [messages]);

  // Hybrid reconnect (Phase 4.4, FR-32): on a re-connect, REST-fetch the messages
  // missed during the drop (since our last-seen id), append them deduped, then the
  // live stream resumes — no gaps, no dupes. The very first connect is covered by
  // the history load, so we only catch up once we already hold a baseline id.
  useEffect(() => {
    if (!socket || !channelId) return;
    const onConnect = () => {
      const after = lastIdRef.current;
      if (!after) return;
      apiFetch<MessageView[]>(
        `/trips/${tripId}/channels/${channelId}/messages/since?after=${encodeURIComponent(after)}`,
      )
        .then((missed) => missed.forEach(upsert))
        .catch(() => undefined);
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [socket, channelId, tripId, upsert]);

  const send = useCallback(
    (body: string) => {
      const text = body.trim();
      if (!socket || !channelId || !text) return;
      const tempId = `temp-${Date.now()}-${tempCounter++}`;
      const optimistic: ChatMessage = {
        id: tempId,
        channelId,
        authorId: myUserId ?? "self",
        authorName: "You",
        // Left null on the optimistic copy: the hook knows the sender's id but
        // not their avatar, and the server's echo lands moments later with the
        // real one. Rendering initials for that instant beats threading the
        // session through just to avoid a flicker.
        authorAvatarUrl: null,
        body: text,
        deleted: false,
        deletedById: null,
        deletedByName: null,
        createdAt: new Date().toISOString(),
        reactions: [],
        mentions: [],
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
    [socket, channelId, myUserId],
  );

  const remove = useCallback(
    (messageId: string) => {
      if (!socket) return;
      // The server broadcasts the tombstone to the whole room (incl. us).
      socket.emit(MESSAGE_DELETE_EVENT, { messageId });
    },
    [socket],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!socket || !myUserId) return;
      let willAdd = true;
      // Optimistically toggle our id in the group; the authoritative set arrives
      // via the reaction:updated broadcast and overwrites this.
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const groups = m.reactions.map((g) => ({
            ...g,
            userIds: [...g.userIds],
          }));
          const group = groups.find((g) => g.emoji === emoji);
          if (group?.userIds.includes(myUserId)) {
            willAdd = false;
            group.userIds = group.userIds.filter((u) => u !== myUserId);
          } else if (group) {
            group.userIds.push(myUserId);
          } else {
            groups.push({ emoji, userIds: [myUserId] });
          }
          return {
            ...m,
            reactions: groups.filter((g) => g.userIds.length > 0),
          };
        }),
      );
      socket.emit(willAdd ? REACTION_ADD_EVENT : REACTION_REMOVE_EVENT, {
        messageId,
        emoji,
      });
    },
    [socket, myUserId],
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
    reload: () => setReloadKey((k) => k + 1),
    send,
    remove,
    toggleReaction,
  };
}

/**
 * Keep the board live off the trip socket (Phase 4.5 retrofit, FR-29). When any
 * member proposes/edits/deletes an option, votes, or an organizer locks/unlocks a
 * decision, the server broadcasts {@link OPTIONS_CHANGED_EVENT}; this hook
 * refetches what that change can have moved, so a locked decision and
 * newly-proposed cards appear for every trip viewer without a manual refresh.
 * The socket only signals *that* a lane changed; TanStack Query re-reads the
 * authoritative state over REST ("tolerate refresh"). Mount once per trip screen
 * with the shared socket.
 *
 * It used to refetch all four queries for every event, which meant a vote — the
 * most frequent thing that happens on a board, and the one that can change the
 * least — cost each viewer a lane read, a dashboard read, a category-list read
 * and a trip-detail read. The last two cannot move on a vote. `payload.kind`
 * carries the blast radius now, and this is where it pays; see
 * {@link OptionsChangedKind} for what each one means and why.
 */
export function useBoardLiveSync(
  socket: Socket | null,
  tripId: string | undefined,
): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!socket || !tripId) return;
    const onChanged = (payload: OptionsChanged) => {
      if (payload.tripId !== tripId) return;
      // Missing `kind` means an older server across a rolling deploy — refetch
      // everything, which is what it used to do and is never wrong.
      const kind = payload.kind ?? "decision";

      // A category rename/repaint leaves the options alone; everything else
      // that reaches here changed one.
      if (kind !== "category") {
        void qc.invalidateQueries({
          queryKey: optionKeys.list(tripId, payload.categoryId),
        });
      }
      // Every kind moves money: an option's cost, a decision's commitment, or
      // the `categoryName`/palette the dashboard labels its lines with.
      void qc.invalidateQueries({ queryKey: dashboardKeys.trip(tripId) });

      if (kind === "decision" || kind === "category") {
        // A lock bumps a single-choice category's version; a rename rewrites
        // the lane's name and colour.
        void qc.invalidateQueries({ queryKey: categoryKeys.list(tripId) });
      }
      if (kind === "decision") {
        // The trip's own dates move with the Dates lane's decision — locking or
        // unlocking one, and now also editing or deleting one that is already
        // locked, since both of those write the trip's dates too.
        void qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
      }
    };
    socket.on(OPTIONS_CHANGED_EVENT, onChanged);
    return () => {
      socket.off(OPTIONS_CHANGED_EVENT, onChanged);
    };
  }, [socket, tripId, qc]);
}
