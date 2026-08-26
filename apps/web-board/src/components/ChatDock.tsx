import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth, useHomeDashboard, useTripCategories } from "@gtp/api-client";
import { can, type HomeTripSummary } from "@gtp/types";
import { Avatar } from "./Avatar";
import { ChatPanel } from "./ChatPanel";
import { useSessionSocket } from "./SessionSocketProvider";
import { t } from "../lib/i18n";

/**
 * Which conversation the dock is showing, and the one way in from outside it.
 *
 * A lane's "Discuss" action names a channel and expects it to open. That used
 * to be a prop on the trip screen's own chat panel; the panel is not the trip
 * screen's any more, so the request travels through here instead.
 */
interface ChatDockValue {
  /** Open the dock on a particular board, optionally on a particular channel. */
  openChannel: (tripId: string, channelId?: string) => void;
}

const ChatDockContext = createContext<ChatDockValue | null>(null);

/**
 * The chat, on every page.
 *
 * It was one panel on one board, which is right for managing a trip and wrong
 * the moment somebody has two in flight: to read what was said on the other
 * one, you had to leave the one you were looking at. The dock opens onto a list
 * of every board's main conversation and drops into the familiar panel from
 * there — the panel is unchanged in what it does, it simply no longer belongs
 * to the page underneath it.
 *
 * **The list is trips, not channels.** A board's category discussions are a way
 * of organising *that* board's conversation and belong inside it, where the
 * switcher already handles them. A flat list of every channel on every trip
 * would be the thing this replaces, one level worse.
 */
export function ChatDockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [view, setView] = useState<DockView>({ kind: "auto" });
  const [open, setOpen] = useState(false);
  const [requestChannelId, setRequestChannelId] = useState<string | null>(null);
  /**
   * The boards whose chat is folded down to a bubble beside the launcher, in
   * the order they were folded.
   *
   * Ids and not trips: the list has to survive the dashboard refetching, and a
   * board this reader has just left should drop out of it rather than sit there
   * as a bubble onto nothing. `Dock` resolves them against the conversations it
   * can actually open.
   */
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const collapse = useCallback((trip: string) => {
    setCollapsed((prev) => (prev.includes(trip) ? prev : [...prev, trip]));
    // Shut, and following the page again: a collapsed panel is not a panel the
    // reader is still in, so reopening the launcher should land where opening
    // it fresh would.
    setOpen(false);
    setView({ kind: "auto" });
  }, []);

  const restore = useCallback((trip: string) => {
    setCollapsed((prev) => prev.filter((id) => id !== trip));
  }, []);

  const openChannel = useCallback((trip: string, channel?: string) => {
    setView({ kind: "trip", tripId: trip });
    setRequestChannelId(channel ?? null);
    setOpen(true);
  }, []);

  const value = useMemo<ChatDockValue>(() => ({ openChannel }), [openChannel]);

  function close() {
    setOpen(false);
    // Back to following the page. Reopening the dock on a board should land on
    // that board again, not on wherever it was left three screens ago.
    setView({ kind: "auto" });
  }

  return (
    <ChatDockContext.Provider value={value}>
      {children}
      {/*
       * Mounted only for a signed-in reader, and the guard has to be *here*.
       *
       * It used to be an early `return null` inside `Dock`, below the hooks —
       * which is not a guard at all: the hooks had already run, so a visitor
       * sitting on the sign-in page fired `GET /dashboard` with no session on
       * every render of every public route. The e2e journeys are what caught
       * it, by failing somewhere else entirely.
       */}
      {user ? (
        <Dock
          open={open}
          onClose={close}
          onOpen={() => setOpen(true)}
          view={view}
          setView={setView}
          collapsed={collapsed}
          onCollapse={collapse}
          onRestore={restore}
          requestChannelId={requestChannelId}
          onRequestHandled={() => setRequestChannelId(null)}
        />
      ) : null}
    </ChatDockContext.Provider>
  );
}

/**
 * Which conversation the dock is showing.
 *
 * `auto` is the resting state and means "whatever the page is about": open the
 * dock while standing on a board and you get that board's conversation, because
 * making somebody who is *looking at a trip* pick that trip out of a list is a
 * step backwards from the panel this replaced. `list` is what Back selects, and
 * has to be its own state rather than a null trip — otherwise `auto` would
 * immediately put the reader back where they just left.
 */
type DockView =
  { kind: "auto" } | { kind: "list" } | { kind: "trip"; tripId: string };

/** Open a board's chat from anywhere — the lane's "Discuss" action. */
export function useChatDock(): ChatDockValue {
  const value = useContext(ChatDockContext);
  if (!value) {
    throw new Error("useChatDock must be used inside ChatDockProvider");
  }
  return value;
}

function Dock({
  open,
  onClose,
  onOpen,
  view,
  setView,
  collapsed,
  onCollapse,
  onRestore,
  requestChannelId,
  onRequestHandled,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  view: DockView;
  setView: (next: DockView) => void;
  collapsed: string[];
  onCollapse: (tripId: string) => void;
  onRestore: (tripId: string) => void;
  requestChannelId: string | null;
  onRequestHandled: () => void;
}) {
  // The provider mounts this only when signed in; `user` is read for its id.
  const { user } = useAuth();
  const { channels, unread, refreshRooms, isTripMuted } = useSessionSocket();
  const { pathname } = useLocation();
  // The same query the overview runs, so opening the dock on the boards page
  // costs nothing and opening it elsewhere warms a cache that page will want.
  const home = useHomeDashboard();

  /**
   * The boards with a conversation this reader may actually read.
   *
   * Gated on the permission rather than on membership: a Guest is a member who
   * cannot see the transcript, and the server agrees — their channels are not
   * in the ready payload at all. Listing the board anyway would offer a door
   * that opens onto nothing.
   */
  const conversations = useMemo(() => {
    const trips = home.data?.trips ?? [];
    return trips.filter((trip) => can(trip.role, "message.read"));
  }, [home.data]);

  /**
   * Unread across a board's channels — what its row in the list badges.
   *
   * **A muted board reports nothing.** The count is still there on the server
   * and still arrives in the ready payload; the mute decides what is *shown*,
   * not what is counted, so lifting it reveals what was missed rather than
   * starting the reader from zero.
   *
   * The silence covers the dock and the toasts — the surfaces that speak up
   * when nobody asked. The channel chips inside an open panel keep their
   * badges: a reader who has opened the conversation is not being pestered by
   * it, and hiding which channel has something new in it at that moment costs
   * them the one thing they opened it to find out.
   */
  const unreadFor = useCallback(
    (trip: string) =>
      isTripMuted(trip)
        ? 0
        : channels
            .filter((c) => c.tripId === trip)
            .reduce((sum, c) => sum + (unread[c.id] ?? 0), 0),
    [channels, unread, isTripMuted],
  );

  // Every board's, for the launcher. The count that matters when the dock is
  // shut is "is anyone talking to me anywhere", which is the whole point of
  // lifting the chat off the page — so a board the reader has quieted must not
  // be able to light it up.
  const totalUnread = useMemo(
    () =>
      channels.reduce(
        (sum, c) => sum + (isTripMuted(c.tripId) ? 0 : (unread[c.id] ?? 0)),
        0,
      ),
    [channels, unread, isTripMuted],
  );

  /**
   * The board this reader is looking at, if they are looking at one.
   *
   * Read off the route rather than passed down, because the dock lives above
   * the routes and has no props from the page under it. A path that is not a
   * board, or a board whose chat this reader cannot read, answers null and the
   * dock falls back to the list.
   */
  const routedTripId = useMemo(() => {
    const m = /^\/trips\/([0-9a-fA-F-]{36})/.exec(pathname);
    return m?.[1] ?? null;
  }, [pathname]);

  /*
   * And keep the rooms in step with the boards this session knows about.
   *
   * `TripDetail` covers the board you are looking at; this covers the rest,
   * which is what the dock's badges are counting. Keyed on the *set* of ids
   * rather than on the query's data, which gets a new identity on every
   * refetch: the rooms must move when membership does and stay put when a name
   * or a date changes.
   */
  const tripIdKey = conversations
    .map((trip) => trip.id)
    .sort()
    .join(",");
  useEffect(() => {
    refreshRooms();
  }, [tripIdKey, refreshRooms]);

  const selectedId =
    view.kind === "trip"
      ? view.tripId
      : view.kind === "auto"
        ? routedTripId
        : null;
  const selected = conversations.find((trip) => trip.id === selectedId) ?? null;

  /**
   * The bubbles, in the order they were folded, and only for boards this reader
   * can still open — a board left in another tab drops its bubble rather than
   * leaving one that opens onto a 404.
   */
  const collapsedTrips = useMemo(
    () =>
      collapsed.flatMap((id) => {
        const trip = conversations.find((c) => c.id === id);
        return trip ? [trip] : [];
      }),
    [collapsed, conversations],
  );

  /*
   * A board is never both open in the panel and folded into a bubble.
   *
   * Collapsing puts the dock back to following the page, so standing *on* the
   * board you just folded and pressing the launcher would otherwise reopen it
   * with its own bubble still sitting beside the button. One rule here rather
   * than a `restore` call on each of the three ways in, which is the kind of
   * list that grows a fourth entry and forgets.
   */
  useEffect(() => {
    if (open && selectedId && collapsed.includes(selectedId)) {
      onRestore(selectedId);
    }
  }, [open, selectedId, collapsed, onRestore]);

  return (
    <>
      {/* The launcher and whatever has been folded down beside it, as one row.
          The bubbles sit to the left of the button, which is the direction the
          panel they came from opens in. */}
      <div className="board__chat-launcher">
        {collapsedTrips.map((trip) => {
          const badge = unreadFor(trip.id);
          return (
            <button
              key={trip.id}
              type="button"
              className="board__chat-bubble"
              aria-label={
                badge > 0
                  ? t("{trip} chat, {n} unread", { trip: trip.name, n: badge })
                  : t("{trip} chat", { trip: trip.name })
              }
              onClick={() => {
                setView({ kind: "trip", tripId: trip.id });
                onOpen();
              }}
            >
              {/* The board's own circle, so a folded conversation is
                  recognisable at 38px without a name under it. It takes a
                  picture through the same `url` every other avatar does. */}
              <Avatar name={trip.name} userId={trip.id} size={38} />
              {badge > 0 ? (
                <span
                  className="board__chat-badge board__chat-badge--bubble"
                  aria-hidden="true"
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          className="board__chat-fab"
          data-tour="chat"
          aria-expanded={open}
          aria-label={
            totalUnread > 0 && !open
              ? t("Chat, {n} unread", { n: totalUnread })
              : t("Chat")
          }
          onClick={() => (open ? onClose() : onOpen())}
        >
          <span aria-hidden="true">💬 </span>
          {t("Chat")}
          {!open && totalUnread > 0 ? (
            <span className="board__chat-badge" aria-hidden="true">
              {totalUnread}
            </span>
          ) : null}
        </button>
      </div>

      {open && selected ? (
        <SelectedTripChat
          trip={selected}
          myUserId={user?.id ?? ""}
          requestChannelId={requestChannelId}
          onRequestHandled={onRequestHandled}
          onClose={onClose}
          onCollapse={() => onCollapse(selected.id)}
          // Only where there is a list worth going back to. On an account with
          // one board, "back" leads to a list of one.
          onBack={
            conversations.length > 1
              ? () => setView({ kind: "list" })
              : undefined
          }
        />
      ) : open ? (
        <TripList
          conversations={conversations}
          loading={home.isPending}
          unreadFor={unreadFor}
          onPick={(id) => setView({ kind: "trip", tripId: id })}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}

/** The boards you can talk on, newest conversation first by unread. */
function TripList({
  conversations,
  loading,
  unreadFor,
  onPick,
  onClose,
}: {
  conversations: HomeTripSummary[];
  loading: boolean;
  unreadFor: (tripId: string) => number;
  onPick: (tripId: string) => void;
  onClose: () => void;
}) {
  return (
    <section
      className="board__chat board__chat--list"
      role="dialog"
      aria-label={t("Conversations")}
    >
      <header className="board__chat-head">
        <span className="board__chat-title">
          <strong>{t("Conversations")}</strong>
        </span>
        <button
          type="button"
          className="board__chat-close"
          aria-label={t("Close chat")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {loading ? (
        <p className="board__muted board__chat-empty" role="status">
          {t("Loading…")}
        </p>
      ) : conversations.length === 0 ? (
        <p className="board__muted board__chat-empty">
          {t("No boards to talk on yet.")}
        </p>
      ) : (
        <ul className="board__chat-trips">
          {conversations.map((trip) => {
            const badge = unreadFor(trip.id);
            return (
              <li key={trip.id}>
                <button
                  type="button"
                  className="board__chat-tripbtn"
                  onClick={() => onPick(trip.id)}
                >
                  {/* Ended by the width of the row rather than at a fixed
                      character count — see the note in `ChatPanel`. */}
                  <span className="board__chat-tripname" title={trip.name}>
                    {trip.name}
                  </span>
                  {badge > 0 ? (
                    <span className="board__chat-tabbadge">{badge}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One board's chat, with the categories its channel names come from.
 *
 * Split out so the categories query is keyed to the board actually being read.
 * Inside `Dock` it would have to be called unconditionally, which means fetching
 * a trip's lanes before anyone has chosen a trip.
 */
function SelectedTripChat({
  trip,
  myUserId,
  requestChannelId,
  onRequestHandled,
  onClose,
  onCollapse,
  onBack,
}: {
  trip: HomeTripSummary;
  myUserId: string;
  requestChannelId: string | null;
  onRequestHandled: () => void;
  onClose: () => void;
  onCollapse: () => void;
  onBack?: () => void;
}) {
  const sessionSocket = useSessionSocket();
  const categories = useTripCategories(trip.id);
  return (
    <ChatPanel
      tripId={trip.id}
      tripName={trip.name}
      sessionSocket={sessionSocket}
      categories={categories.data ?? []}
      myRole={trip.role}
      myUserId={myUserId}
      requestChannelId={requestChannelId}
      onRequestHandled={onRequestHandled}
      onClose={onClose}
      onCollapse={onCollapse}
      onBack={onBack}
    />
  );
}
