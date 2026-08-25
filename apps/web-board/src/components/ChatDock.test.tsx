import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, type SessionSocket } from "@gtp/api-client";
import type { ChannelView } from "@gtp/types";
import { ChatDockProvider } from "./ChatDock";

/**
 * The chat, lifted off the page it used to belong to.
 *
 * What is new here is the level *above* the panel: a launcher that counts every
 * board at once, and a list you choose a conversation from. The panel itself is
 * covered by `ChatPanel.test` and is deliberately not re-tested through this —
 * these pin the three things the dock decides.
 */

const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";

function channel(id: string, tripId: string): ChannelView {
  return {
    id,
    tripId,
    categoryId: null,
    type: "GENERAL",
    lastMessageAt: null,
  };
}

let socketValue: SessionSocket;

vi.mock("./SessionSocketProvider", () => ({
  useSessionSocket: () => socketValue,
  SessionSocketProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

const auth = { user: { id: "u1", displayName: "Ada" } };
vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => auth,
    useHomeDashboard: () => ({
      isPending: false,
      data: {
        total: 2,
        trips: [
          { id: TRIP_A, name: "Lisbon 2026", role: "PARTICIPANT" },
          { id: TRIP_B, name: "Tromsø", role: "GUEST" },
        ],
      },
    }),
    useTripCategories: () => ({ data: [] }),
  };
});

function renderDock() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatDockProvider>
        <div />
      </ChatDockProvider>
    </QueryClientProvider>,
  );
}

describe("the chat dock", () => {
  beforeEach(() => {
    socketValue = {
      status: "connected",
      channels: [channel("a-gen", TRIP_A), channel("b-gen", TRIP_B)],
      unread: {},
      socket: null,
      markChannelRead: () => {},
      setActiveChannel: () => {},
      refreshRooms: () => {},
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("counts every board at once, not just the one you are looking at", () => {
    // The whole reason the chat came off the page: when it is shut, the
    // question is "is anyone talking to me anywhere", and the old badge could
    // only ever answer for the board underneath it.
    socketValue = {
      ...socketValue,
      unread: { "a-gen": 2, "b-gen": 3 },
    };
    renderDock();
    expect(
      screen.getByRole("button", { name: "Chat, 5 unread" }),
    ).toBeInTheDocument();
  });

  it("opens onto the boards you can talk on, and leaves out the ones you cannot", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: /chat/i }));

    // A Guest is a member who cannot read the transcript — the server never
    // sends their channels — so offering the board would be a door onto
    // nothing.
    expect(
      screen.getByRole("button", { name: /Lisbon 2026/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tromsø/ })).toBeNull();
  });

  it("drops into a board's conversation and comes back out", async () => {
    // Two boards would give a Back; this account has one readable, so the
    // panel is the end of the road and there is nothing to go back to.
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: /chat/i }));
    fireEvent.click(screen.getByRole("button", { name: /Lisbon 2026/ }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Trip chat" })).toBeVisible(),
    );
    expect(screen.queryByRole("button", { name: "All conversations" })).toBeNull();
  });
});
