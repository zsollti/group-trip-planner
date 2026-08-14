import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, ChannelView } from "@gtp/types";
import { createQueryClient, type TripSocket } from "@gtp/api-client";
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
      containerRef: { current: null },
      measureRef: { current: null },
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

function channel(n: number): ChannelView {
  return {
    id: `ch${n}`,
    tripId: TRIP_ID,
    categoryId: `c${n}`,
    type: "CATEGORY",
  };
}

const categories = [
  category(1, "Transport"),
  category(2, "Accommodation"),
  category(3, "Activities"),
];

const selectedChannels: string[] = [];

function socket(): TripSocket {
  return {
    status: "connected",
    channels: [
      { id: "gen", tripId: TRIP_ID, categoryId: null, type: "GENERAL" },
      channel(1),
      channel(2),
      channel(3),
    ],
    unread: {},
    socket: null,
    markChannelRead: () => {},
    setActiveChannel: (id) => {
      if (id) selectedChannels.push(id);
    },
  };
}

function renderPanel() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatPanel
        tripId={TRIP_ID}
        tripName="Lisbon 2026"
        tripSocket={socket()}
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
    fireEvent.click(screen.getByRole("button", { name: /chat/i }));
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
