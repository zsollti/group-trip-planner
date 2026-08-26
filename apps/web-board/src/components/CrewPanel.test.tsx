import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { TripRole } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { CrewPanel } from "./CrewPanel";

/**
 * The crew strip's per-person actions.
 *
 * Two things are worth pinning and neither is the happy path. The first is the
 * rank rule: a panel that offered a co-organizer a way to demote the owner
 * would be a client-side hole in front of a server that says no — the request
 * would fail, but the board would have proposed it. The second is the confirm:
 * kick, block and transfer are the three acts on this board that cannot be
 * taken back, and an icon on a hover panel is exactly the kind of control that
 * quietly loses one.
 */
const TRIP_ID = "11111111-1111-4111-8111-111111111111";

const roster = {
  members: [
    {
      userId: "owner",
      displayName: "Ada Owner",
      avatarUrl: null,
      role: "OWNER",
      joinedAt: "2026-08-01T00:00:00.000Z",
      isOwner: true,
    },
    {
      userId: "co",
      displayName: "Cass Co",
      avatarUrl: null,
      role: "CO_ORGANIZER",
      joinedAt: "2026-08-01T00:00:00.000Z",
      isOwner: false,
    },
    {
      userId: "trav",
      displayName: "Tom Traveler",
      avatarUrl: null,
      role: "PARTICIPANT",
      joinedAt: "2026-08-01T00:00:00.000Z",
      isOwner: false,
    },
  ],
  blocked: [],
};

function renderPanel(myRole: TripRole, myUserId: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CrewPanel
        tripId={TRIP_ID}
        myRole={myRole}
        myUserId={myUserId}
        onManage={() => {}}
        onInvite={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("crew quick actions", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(roster), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("offers nothing on yourself, or on anyone you do not outrank", async () => {
    // A co-organizer: the owner is above them and the other co-organizer is a
    // peer, so the only actionable row is the traveler's.
    renderPanel("CO_ORGANIZER", "co");
    const triggers = await screen.findAllByRole("button", {
      name: /Actions for/,
    });
    expect(triggers.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Actions for Tom Traveler",
    ]);
  });

  it("offers a guest nothing at all", async () => {
    renderPanel("GUEST", "trav");
    expect(await screen.findByText("Ada Owner")).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: /Actions for/ }),
    ).toHaveLength(0);
  });

  it("names every icon, and marks the role they already have", async () => {
    renderPanel("OWNER", "owner");
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Tom Traveler" }),
    );

    for (const label of [
      "Set Tom Traveler as Organizer",
      "Set Tom Traveler as Traveler",
      "Set Tom Traveler as Guest",
      "Make Tom Traveler the owner",
      "Remove Tom Traveler from the trip",
      "Remove Tom Traveler and block them from rejoining",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Their current role is shown lit and unclickable rather than left out: a
    // request that changes nothing is not an action.
    expect(
      screen.getByRole("button", { name: "Set Tom Traveler as Traveler" }),
    ).toBeDisabled();
  });

  it("draws the panel outside the strip that would clip it", async () => {
    renderPanel("OWNER", "owner");
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Tom Traveler" }),
    );

    // The strip scrolls sideways, so a panel inside it is cut off at its edge
    // — which is what a member near either end used to get. It is portalled to
    // <body> instead, and this is the fact that says so.
    const action = screen.getByRole("button", {
      name: "Remove Tom Traveler from the trip",
    });
    expect(document.querySelector(".crew")?.contains(action)).toBe(false);
    expect(document.body.contains(action)).toBe(true);
  });

  it("stays open while the pointer is on the panel rather than the row", async () => {
    renderPanel("OWNER", "owner");
    const row = await screen.findByRole("button", {
      name: "Actions for Tom Traveler",
    });
    fireEvent.click(row);

    const action = screen.getByRole("button", {
      name: "Remove Tom Traveler from the trip",
    });
    // Moving onto the panel means leaving the row, and the panel is not inside
    // the row any more: a close rule written as "the pointer left the row"
    // would shut the panel on the way to it.
    fireEvent.pointerOver(action);
    expect(
      screen.getByRole("button", { name: "Remove Tom Traveler from the trip" }),
    ).toBeInTheDocument();

    // Anywhere else does close it.
    fireEvent.pointerOver(document.body);
    expect(
      screen.queryByRole("button", {
        name: "Remove Tom Traveler from the trip",
      }),
    ).not.toBeInTheDocument();
  });

  it("asks before removing, rather than removing", async () => {
    renderPanel("OWNER", "owner");
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Tom Traveler" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Tom Traveler from the trip" }),
    );

    // Nothing has been sent — the only thing that happened is the question, and
    // it says what happens afterwards, which is the whole difference between
    // this and the button beside it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(/Remove Tom Traveler from this trip\? You can invite/),
    ).toBeInTheDocument();
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(
      calls.filter(([, init]) => init && init.method && init.method !== "GET"),
    ).toHaveLength(0);
  });

  it("hides the owner hand-off from anyone who is not the owner", async () => {
    renderPanel("CO_ORGANIZER", "co");
    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Tom Traveler" }),
    );
    expect(
      screen.queryByRole("button", { name: /the owner/ }),
    ).not.toBeInTheDocument();
    // …and offers only the roles below their own.
    expect(
      screen.queryByRole("button", { name: /as Organizer/ }),
    ).not.toBeInTheDocument();
  });
});
