import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, ChannelView } from "@gtp/types";
import { createQueryClient, type SessionSocket } from "@gtp/api-client";
import { ChatPanel } from "./ChatPanel";

/**
 * Chat channel switcher — functional/DOM tests (no screenshot tests).
 *
 * The switcher's fit calculation needs real widths, and jsdom does no layout:
 * every `offsetWidth` is 0, so `useFitCount` always answers "everything fits"
 * and the collapsed row can never be reached through rendering alone. That is
 * exactly the seam `lib/fitTabs` was split along — `fitCount` is unit-tested on
 * its own numbers, and here the measuring hook is stubbed so the *collapsed*
 * row can be driven at all.
 *
 * What these guard is the thing that broke in use: the "＋N" popover was a
 * descendant of the row that clips the chips, so it was cut to the height of a
 * single chip and every collapsed channel but the first was unclickable — a
 * CSS-only defect, invisible to jsdom. The structural invariant that fixes it
 * (trigger outside the clipping strip) *is* assertable, so it is asserted.
 */

const TRIP_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../lib/fitTabs", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/fitTabs")>("../lib/fitTabs");
  return {
    ...actual,
    // Only the trip channel fits; the three category channels collapse.
    useFitCount: () => ({
      // Callback refs, as the real hook returns — it measures on mount rather
      // than on a changed item count, which is what it did not use to do.
      containerRef: () => {},
      measureRef: () => {},
      reserveRef: () => {},
      visibleCount: 1,
    }),
  };
});

function category(n: number, name: string): CategoryView {
  return {
    id: `c${n}`,
    name,
    singleChoice: false,
    isBuiltin: false,
    builtinKey: null,
    paletteKey: null,
    position: n,
    version: 0,
  };
}

function channel(n: number, lastMessageAt: string | null = null): ChannelView {
  return {
    id: `ch${n}`,
    tripId: TRIP_ID,
    categoryId: `c${n}`,
    type: "CATEGORY",
    lastMessageAt,
  };
}

const categories = [
  category(1, "Transport"),
  category(2, "Accommodation"),
  category(3, "Activities"),
];

const selectedChannels: string[] = [];

function socket(): SessionSocket {
  return {
    status: "connected",
    channels: [
      {
        id: "gen",
        tripId: TRIP_ID,
        categoryId: null,
        type: "GENERAL",
        lastMessageAt: null,
      },
      channel(1),
      channel(2),
      channel(3),
    ],
    unread: {},
    socket: null,
    markChannelRead: () => {},
    setActiveChannel: (id: string | null) => {
      if (id) selectedChannels.push(id);
    },
    // Nothing is muted in these fixtures; the mute has its own tests.
    isTripMuted: () => false,
    tripMutedUntil: () => null,
    setTripMute: () => {},
    refreshRooms: () => {},
  };
}

function renderPanel(channels?: ChannelView[], tripName = "Lisbon 2026") {
  const base = socket();
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatPanel
        tripId={TRIP_ID}
        tripName={tripName}
        sessionSocket={channels ? { ...base, channels } : base}
        onClose={() => {}}
        onCollapse={() => {}}
        categories={categories}
        myRole="PARTICIPANT"
        myUserId="u1"
        requestChannelId={null}
        onRequestHandled={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("chat channel switcher overflow", () => {
  beforeEach(() => {
    selectedChannels.length = 0;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPanel();
  });

  it("collapses every channel that does not fit behind one trigger", () => {
    expect(
      screen.getByRole("button", { name: "3 more channels" }),
    ).toBeInTheDocument();
  });

  it("offers all of the collapsed channels, not just the first", () => {
    fireEvent.click(screen.getByRole("button", { name: "3 more channels" }));

    for (const name of ["Transport", "Accommodation", "Activities"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("opens a channel reached through the overflow menu", () => {
    fireEvent.click(screen.getByRole("button", { name: "3 more channels" }));
    fireEvent.click(screen.getByRole("button", { name: "Activities" }));

    expect(selectedChannels).toContain("ch3");
  });

  it("keeps the overflow trigger outside the strip that clips the chips", () => {
    // The regression guard. `.board__chat-strip` carries `overflow: hidden` so a
    // chip that doesn't quite fit is cut rather than escaping the panel; a
    // popover anchored inside it is cut by the same rule, which is what made the
    // collapsed channels unreachable. The trigger must stay a sibling.
    // Asserted from both sides on purpose: "the trigger is not in the strip" is
    // vacuously true if the strip stops existing and the clip moves back up to
    // the row, which is precisely the regression.
    const chip = screen.getByRole("button", { name: "Lisbon 2026" });
    expect(chip.closest(".board__chat-strip")).not.toBeNull();

    const trigger = screen.getByRole("button", { name: "3 more channels" });
    expect(trigger.closest(".board__chat-strip")).toBeNull();
    expect(trigger.closest(".board__chat-tabs")).not.toBeNull();
  });
});

/**
 * What a deleted message leaves behind.
 *
 * "message deleted" was the whole of it, for every case — which left the room
 * unable to tell a person taking their own words back from an organizer taking
 * them away. The distinction is drawn from the ids rather than from a flag or a
 * role, so these three cases are the whole of the behaviour: mine, someone
 * else's, and a tombstone with nobody recorded on it.
 */
describe("a deleted message", () => {
  function withHistory(messages: unknown[]) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages, nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPanel();
  }

  function tomb(over: Record<string, unknown>) {
    return {
      id: "m1",
      channelId: "gen",
      authorId: "u2",
      authorName: "Anna Weber",
      authorAvatarUrl: null,
      body: null,
      deleted: true,
      deletedById: null,
      deletedByName: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      mentions: [],
      ...over,
    };
  }

  it("names the author when they took it back themselves", async () => {
    withHistory([tomb({ deletedById: "u2", deletedByName: "Anna Weber" })]);
    expect(
      await screen.findByText("Anna Weber deleted their message"),
    ).toBeInTheDocument();
  });

  it("names both when somebody else removed it", async () => {
    // The case the old wording hid: moderation that looks, to everyone in the
    // room, exactly like the author changing their mind.
    withHistory([tomb({ deletedById: "u1", deletedByName: "Demo User" })]);
    expect(
      await screen.findByText("Demo User deleted Anna Weber's message"),
    ).toBeInTheDocument();
  });

  it("falls back to the bare wording when no deleter is recorded", async () => {
    // Tombstones written before this shipped, and any whose deleter has since
    // deleted their account — the foreign key nulls itself. Both are ordinary.
    withHistory([tomb({})]);
    expect(await screen.findByText("message deleted")).toBeInTheDocument();
  });

  it("never shows the body of a deleted message", async () => {
    // The tombstone gained a name; it must not gain the words. The server
    // nulls the body, and this is the client's half of that promise.
    withHistory([
      tomb({
        deletedById: "u1",
        deletedByName: "Demo User",
        body: "the thing that was said",
      }),
    ]);
    await screen.findByText("Demo User deleted Anna Weber's message");
    expect(screen.queryByText("the thing that was said")).toBeNull();
  });
});

/**
 * The order the chips are in. jsdom measures nothing, so the row collapses to a
 * single chip and the rest go behind the trigger — which suits this fine: the
 * overflow menu lists the channels in the same order the row would have, so it
 * is where the ordering can be read without a layout engine.
 */
describe("chat channel switcher order", () => {
  beforeEach(() => {
    selectedChannels.length = 0;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("leads with the trip's own channel, then the most recently spoken in", () => {
    renderPanel([
      {
        id: "gen",
        tripId: TRIP_ID,
        categoryId: null,
        type: "GENERAL",
        // Quiet, and still first: General is a landmark, not a competitor.
        lastMessageAt: null,
      },
      channel(1, "2026-08-25T09:00:00.000Z"),
      channel(2, "2026-08-25T12:00:00.000Z"),
      channel(3, "2026-08-25T10:00:00.000Z"),
    ]);

    // The one chip that fits is General; the rest are in the menu, in order.
    expect(
      screen.getByRole("button", { name: "Lisbon 2026" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 more channels" }));
    const labels = Array.from(
      document.querySelectorAll(".menu__item-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Accommodation", "Activities", "Transport"]);
  });

  it("does not reshuffle while the panel is open", () => {
    // The chip under the reader's cursor has to stay put. A message landing in
    // a quiet channel moves its `lastMessageAt` — and must not move its chip
    // until the row next re-sorts, which is on open or on a channel appearing.
    const { rerender } = renderPanel([
      {
        id: "gen",
        tripId: TRIP_ID,
        categoryId: null,
        type: "GENERAL",
        lastMessageAt: null,
      },
      channel(1, "2026-08-25T09:00:00.000Z"),
      channel(2, "2026-08-25T12:00:00.000Z"),
      channel(3, "2026-08-25T10:00:00.000Z"),
    ]);

    const talkative = {
      ...socket(),
      channels: [
        {
          id: "gen",
          tripId: TRIP_ID,
          categoryId: null,
          type: "GENERAL" as const,
          lastMessageAt: null,
        },
        // Transport was last and has just become the newest.
        channel(1, "2026-08-25T13:00:00.000Z"),
        channel(2, "2026-08-25T12:00:00.000Z"),
        channel(3, "2026-08-25T10:00:00.000Z"),
      ],
    };
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ChatPanel
          tripId={TRIP_ID}
          tripName="Lisbon 2026"
          sessionSocket={talkative}
          onClose={() => {}}
          onCollapse={() => {}}
          categories={categories}
          myRole="PARTICIPANT"
          myUserId="u1"
          requestChannelId={null}
          onRequestHandled={() => {}}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "3 more channels" }));
    const labels = Array.from(
      document.querySelectorAll(".menu__item-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Accommodation", "Activities", "Transport"]);
  });
});

/**
 * Who the "@" list offers.
 *
 * A mention notifies everyone it names except its author — the rule lives in
 * `notificationRecipients` and is the same one that stops a busy chat mailing
 * you your own messages. So your own name on this list is the list advertising
 * the one choice on it that provably does nothing: no badge, no email, no trace
 * that anything happened at all.
 */
describe("the @mention list", () => {
  beforeEach(() => {
    // A fresh Response per call: a Response body can only be read once, so one
    // shared instance is drained by whichever query gets there first and every
    // other one fails with an unusable body. The chat history and the member
    // list both fetch here.
    const roster = {
      members: [
        {
          userId: "u1",
          displayName: "Zsolt Pinter",
          avatarUrl: null,
          role: "PARTICIPANT",
          joinedAt: "2026-08-01T00:00:00.000Z",
          isOwner: false,
        },
        {
          userId: "u2",
          displayName: "Zara Ellis",
          avatarUrl: null,
          role: "ORGANIZER",
          joinedAt: "2026-08-01T00:00:00.000Z",
          isOwner: true,
        },
      ],
      blocked: [],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).includes("/members")
              ? roster
              : { messages: [], nextCursor: null },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  it("offers everyone but the person typing", async () => {
    renderPanel();

    // Both names begin "Z", so a filter that only matched the query would keep
    // them both — this is the viewer being excluded, not the prefix.
    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "@Z" } });
    // The token being completed is the one just before the caret, and jsdom
    // does not move a caret for us.
    input.setSelectionRange(2, 2);
    fireEvent.keyUp(input);

    expect(
      await screen.findByRole("option", { name: "@Zara Ellis" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "@Zsolt Pinter" }),
    ).not.toBeInTheDocument();
  });
});

describe("the board's name above the conversation", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("is written out whole, however long it is", () => {
    const name = "Lisbon long weekend with everyone";
    renderPanel(undefined, name);

    // It used to be cut to 15 characters wherever it appeared, which on a
    // header this wide read as "Lisbon long wee…" with room to spare. The box
    // ends it now, and nothing in the DOM is missing.
    const eyebrow = screen.getAllByTitle(name)[0];
    expect(eyebrow).toBeInTheDocument();
    expect(eyebrow?.textContent).toBe(name);
  });
  it("says it once, not once over itself", () => {
    const name = "Lisbon 2026";
    renderPanel(undefined, name);

    /*
     * The trip-wide channel is *named after the trip*, so the header printed
     * the name as the small line and again as the heading directly under it —
     * the same six words twice, in two sizes. The small line answers "which
     * trip's Accommodation?", and on this channel nobody is asking.
     */
    const head = document.querySelector(".board__chat-head")!;
    const shown = [...head.querySelectorAll("*")].filter(
      (el) => el.textContent === name && el.children.length === 0,
    );
    expect(shown).toHaveLength(1);
  });

  it("keeps saying it on a channel that is not the trip's own", () => {
    const name = "Lisbon 2026";
    renderPanel(undefined, name);
    // Every category channel is collapsed behind the overflow trigger here —
    // see the stubbed `useFitCount` at the top of this file.
    fireEvent.click(screen.getByRole("button", { name: "3 more channels" }));
    fireEvent.click(screen.getByRole("button", { name: "Transport" }));

    // "Transport" as a heading does not say whose transport, and the dock spans
    // every board — so here the trip's name is the whole point of the line.
    const head = document.querySelector(".board__chat-head")!;
    expect(head.querySelector(".board__chat-trip")?.textContent).toBe(name);
  });
});

/**
 * The chat's own menu.
 *
 * Search is a *mode* of this panel rather than a surface of its own, so what is
 * worth pinning here is the swap: while it is open the log and the composer are
 * gone, and choosing a hit puts them back on the hit's channel. `ChatSearch`
 * tests the searching itself.
 */
describe("the chat menu", () => {
  beforeEach(() => {
    selectedChannels.length = 0;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderPanel();
  });

  function openSearch() {
    fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Search chat" }));
  }

  it("opens the search from the menu", () => {
    openSearch();
    expect(
      screen.getByRole("searchbox", { name: /Search this/ }),
    ).toBeInTheDocument();
  });

  it("puts the results where the log was, not on top of it", () => {
    // The log and the composer are the two things a search replaces. Asserted
    // as absence rather than as a class, because "covered by a popover" and
    // "replaced" look the same to a class check and only one of them is this.
    expect(document.querySelector(".board__chat-log")).not.toBeNull();
    openSearch();
    expect(document.querySelector(".board__chat-log")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  });

  it("closes the search again from the same item", () => {
    openSearch();
    fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelector(".board__chat-log")).not.toBeNull();
  });
});

/**
 * Muting a board's chat from its own menu.
 *
 * The panel's share of the feature is the menu: which rows it offers, what it
 * sends, and that it hands the answer back to the socket so the badges go quiet
 * without waiting for a reconnect. What the badges then do with it belongs to
 * the dock, and what "an hour" means belongs to the server.
 */
describe("muting a board's chat", () => {
  let sent: unknown[];
  let recorded: [string, unknown][];

  function renderWith(mute: { muted: boolean; mutedUntil: string | null }) {
    sent = [];
    recorded = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("/chat-mute")) {
        sent.push(JSON.parse(String((init as RequestInit).body)));
        return Promise.resolve(
          new Response(JSON.stringify({ muted: true, mutedUntil: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [], nextCursor: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const base = socket();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ChatPanel
          tripId={TRIP_ID}
          tripName="Lisbon 2026"
          sessionSocket={{
            ...base,
            isTripMuted: () => mute.muted,
            tripMutedUntil: () => mute.mutedUntil,
            setTripMute: (tripId, view) => recorded.push([tripId, view]),
          }}
          onClose={() => {}}
          onCollapse={() => {}}
          categories={categories}
          myRole="PARTICIPANT"
          myUserId="u1"
          requestChannelId={null}
          onRequestHandled={() => {}}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat menu" }));
  }

  afterEach(() => vi.restoreAllMocks());

  it("offers the three durations while the board is not muted", () => {
    renderWith({ muted: false, mutedUntil: null });

    // Anchored regexes, not exact strings: `Menu` renders an item's `note`
    // inside the button, and describing a node does not take it out of the
    // accessible name, so a noted row is named "<label> <note>".
    for (const label of [
      /^Mute chat for an hour/,
      /^Mute chat for a day/,
      /^Mute chat until I turn it back on/,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Nothing to unmute yet.
    expect(screen.queryByRole("button", { name: /^Unmute chat/ })).toBeNull();
  });

  it("sends the duration the reader chose", async () => {
    renderWith({ muted: false, mutedUntil: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Mute chat for a day" }),
    );

    await waitFor(() => expect(sent).toEqual([{ duration: "DAY" }]));
  });

  it("tells the socket at once, so the badges do not wait for a reconnect", async () => {
    renderWith({ muted: false, mutedUntil: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Mute chat for an hour" }),
    );

    await waitFor(() => expect(recorded).toHaveLength(1));
    expect(recorded[0]?.[0]).toBe(TRIP_ID);
  });

  it("collapses to one row once it is muted, and says until when", () => {
    // A mute that runs out at a knowable time; the row says so rather than
    // making the reader remember which of the three they picked.
    renderWith({ muted: true, mutedUntil: "2026-03-04T15:00:00.000Z" });

    expect(
      screen.getByRole("button", { name: /^Unmute chat/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mute chat/ })).toBeNull();
    expect(screen.getByText(/Muted until/)).toBeInTheDocument();
  });

  it("lifts the mute with no duration at all", async () => {
    renderWith({ muted: true, mutedUntil: null });
    fireEvent.click(screen.getByRole("button", { name: /^Unmute chat/ }));

    await waitFor(() => expect(sent).toEqual([{ duration: null }]));
  });

  it("says a mute with no expiry stands until it is lifted", () => {
    renderWith({ muted: true, mutedUntil: null });
    expect(
      screen.getByText("Muted until you turn it back on"),
    ).toBeInTheDocument();
  });
});
