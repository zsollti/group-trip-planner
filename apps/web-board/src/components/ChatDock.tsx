import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useHomeDashboard, useTripCategories } from "@gtp/api-client";
import { can, type HomeTripSummary } from "@gtp/types";
import { ChatPanel } from "./ChatPanel";
import { useSessionSocket } from "./SessionSocketProvider";
import { truncateName } from "../lib/truncate";
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
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [requestChannelId, setRequestChannelId] = useState<string | null>(null);

  const openChannel = useCallback((trip: string, channel?: string) => {
    setTripId(trip);
    setRequestChannelId(channel ?? null);
    setOpen(true);
  }, []);

  const value = useMemo<ChatDockValue>(() => ({ openChannel }), [openChannel]);

  return (
    <ChatDockContext.Provider value={value}>
      {children}
      <Dock
        open={open}
        setOpen={setOpen}
        tripId={tripId}
        setTripId={setTripId}
        requestChannelId={requestChannelId}
        onRequestHandled={() => setRequestChannelId(null)}
      />
    </ChatDockContext.Provider>
  );
}

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
  setOpen,
  tripId,
  setTripId,
  requestChannelId,
  onRequestHandled,
}: {
  open: boolean;
  setOpen: (next: boolean) => void;
  tripId: string | null;
  setTripId: (next: string | null) => void;
  requestChannelId: string | null;
  onRequestHandled: () => void;
}) {
  const { user } = useAuth();
  const { channels, unread } = useSessionSocket();
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

  /** Unread across a board's channels — what its row in the list badges. */
  const unreadFor = useCallback(
    (trip: string) =>
      channels
        .filter((c) => c.tripId === trip)
        .reduce((sum, c) => sum + (unread[c.id] ?? 0), 0),
    [channels, unread],
  );

  // Every board's, for the launcher. The count that matters when the dock is
  // shut is "is anyone talking to me anywhere", which is the whole point of
  // lifting the chat off the page.
  const totalUnread = useMemo(
    () => channels.reduce((sum, c) => sum + (unread[c.id] ?? 0), 0),
    [channels, unread],
  );

  const selected = conversations.find((trip) => trip.id === tripId) ?? null;

  // Nothing to dock for a signed-out visitor, and nothing to say either.
  if (!user) return null;

  return (
    <>
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
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">💬 </span>
        {t("Chat")}
        {!open && totalUnread > 0 ? (
          <span className="board__chat-badge" aria-hidden="true">
            {totalUnread}
          </span>
        ) : null}
      </button>

      {open && selected ? (
        <SelectedTripChat
          trip={selected}
          myUserId={user.id}
          requestChannelId={requestChannelId}
          onRequestHandled={onRequestHandled}
          onClose={() => setOpen(false)}
          // Only where there is a list worth going back to. On an account with
          // one board, "back" leads to a list of one.
          onBack={conversations.length > 1 ? () => setTripId(null) : undefined}
        />
      ) : open ? (
        <TripList
          conversations={conversations}
          loading={home.isPending}
          unreadFor={unreadFor}
          onPick={setTripId}
          onClose={() => setOpen(false)}
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
                  <span className="board__chat-tripname">
                    {truncateName(trip.name)}
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
  onBack,
}: {
  trip: HomeTripSummary;
  myUserId: string;
  requestChannelId: string | null;
  onRequestHandled: () => void;
  onClose: () => void;
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
      onBack={onBack}
    />
  );
}
