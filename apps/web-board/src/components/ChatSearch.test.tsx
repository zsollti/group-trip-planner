import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ChannelView, MessageView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { ChatSearch } from "./ChatSearch";

/**
 * Searching a board's transcript — functional/DOM tests (no screenshot tests).
 *
 * The three things worth pinning are the three the shape was chosen for: a hit
 * says which conversation it came from (the whole reason the search is
 * trip-scoped rather than channel-scoped), the reader's term is marked in the
 * body they get back, and pressing a hit opens its channel rather than trying
 * to jump to the message's place in history.
 *
 * The debounce is real time, not fake timers: 250ms is well inside `waitFor`'s
 * budget, and driving it with real timers means these also fail if the debounce
 * is ever removed and every keystroke becomes a request.
 */

const TRIP_ID = "11111111-1111-4111-8111-111111111111";

const channels: ChannelView[] = [
  {
    id: "gen",
    tripId: TRIP_ID,
    categoryId: null,
    type: "GENERAL",
    lastMessageAt: null,
  },
  {
    id: "ch1",
    tripId: TRIP_ID,
    categoryId: "c1",
    type: "CATEGORY",
    lastMessageAt: null,
  },
];

function message(over: Partial<MessageView> & { id: string }): MessageView {
  return {
    channelId: "gen",
    authorId: "u9",
    authorName: "Ada",
    authorAvatarUrl: null,
    body: "hello",
    deleted: false,
    deletedById: null,
    deletedByName: null,
    createdAt: "2026-03-04T10:15:00.000Z",
    reactions: [],
    mentions: [],
    ...over,
  };
}

/** The name the panel would give a channel, mirrored for the component. */
function channelName(channel: ChannelView): string {
  return channel.type === "GENERAL" ? "Lisbon 2026" : "Transport";
}

/** Answer every search with these hits, and record the URLs that were asked. */
function answerWith(messages: MessageView[], truncated = false) {
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    asked.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ messages, truncated }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return asked;
}

function renderSearch(onPick: (channelId: string) => void = () => {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatSearch
        tripId={TRIP_ID}
        channels={channels}
        channelName={channelName}
        onPick={onPick}
      />
    </QueryClientProvider>,
  );
}

function type(text: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: /Search this/ }), {
    target: { value: text },
  });
}

describe("searching a board's chat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not ask the server about a single character", async () => {
    const asked = answerWith([]);
    renderSearch();
    type("a");

    // Long enough for the debounce to have fired twice over. Inside `act`
    // because it does fire — it sets the debounced term, finds it too short,
    // and asks nothing. That is the assertion.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(asked).toHaveLength(0);
    expect(screen.getByText(/Keep typing/)).toBeInTheDocument();
  });

  it("searches once the term is long enough, and says how many matched", async () => {
    const asked = answerWith([
      message({ id: "m1", body: "the airport transfer is booked" }),
    ]);
    renderSearch();
    type("airport");

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toContain(`/trips/${TRIP_ID}/messages/search?q=airport`);
    expect(await screen.findByText("1 matching")).toBeInTheDocument();
  });

  it("names the channel each hit came from", async () => {
    answerWith([
      message({ id: "m1", channelId: "gen", body: "airport one" }),
      message({ id: "m2", channelId: "ch1", body: "airport two" }),
    ]);
    renderSearch();
    type("airport");

    // The point of a trip-wide search: two channels answering one question.
    expect(await screen.findByText("Lisbon 2026")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
  });

  it("marks every occurrence of the term, whatever case it was written in", async () => {
    answerWith([message({ id: "m1", body: "Airport, then the airport bus" })]);
    renderSearch();
    type("airport");

    await screen.findByText("1 matching");
    const marks = document.querySelectorAll("mark.board__chat-hit");
    expect(marks).toHaveLength(2);
    // Marked with the case it was written in, not with the case it was sought.
    expect([...marks].map((m) => m.textContent)).toEqual([
      "Airport",
      "airport",
    ]);
  });

  it("opens the hit's channel rather than jumping into its history", async () => {
    const picked: string[] = [];
    answerWith([message({ id: "m1", channelId: "ch1", body: "airport bus" })]);
    renderSearch((id) => picked.push(id));
    type("airport");

    const hit = await screen.findByRole("button", { name: /Ada in Transport/ });
    fireEvent.click(hit);
    expect(picked).toEqual(["ch1"]);
  });

  it("says so when the cap cut the list short", async () => {
    answerWith([message({ id: "m1", body: "airport" })], true);
    renderSearch();
    type("airport");

    expect(
      await screen.findByText(/Narrow the search to see fewer/),
    ).toBeInTheDocument();
  });

  it("says plainly when nothing matched", async () => {
    answerWith([]);
    renderSearch();
    type("nothing at all");

    expect(
      await screen.findByText("No messages match that."),
    ).toBeInTheDocument();
  });

  /**
   * A tombstone has no body and the server never matches one, so this row can
   * only appear if that promise breaks. It must not render as a blank hit.
   */
  it("drops a hit the server should never have sent", async () => {
    answerWith([
      message({ id: "m1", body: null, deleted: true }),
      message({ id: "m2", body: "airport bus" }),
    ]);
    renderSearch();
    type("airport");

    expect(await screen.findByText("1 matching")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Ada in/ })).toHaveLength(1);
  });
});

describe("the search field", () => {
  beforeEach(() => {
    answerWith([]);
    renderSearch();
  });
  afterEach(() => vi.restoreAllMocks());

  it("takes focus on open, because opening it means typing into it", () => {
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: /Search this/ }),
    );
  });

  it("invites the reader before they have typed anything", () => {
    expect(
      screen.getByText("Type to search every conversation on this board."),
    ).toBeInTheDocument();
  });
});
