import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, OptionView, TripRole } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { BoardCanvas } from "./BoardCanvas";

/**
 * Board canvas (Phase 3.5) — functional/DOM tests (no screenshot tests). Real
 * pointer-drag is progressive enhancement jsdom can't drive, so these assert the
 * two things that don't need a live drag: locked options are collected into the
 * global "Decided" column (not their lane), and the drag grips appear only for
 * organizers on an active trip.
 */

const JSON_HEADERS = { "content-type": "application/json" };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const category: CategoryView = {
  id: "c1",
  name: "Stay",
  singleChoice: true,
  isBuiltin: true,
  builtinKey: "ACCOMMODATION",
  position: 2,
  version: 0,
};

function opt(over: Partial<OptionView>): OptionView {
  return {
    id: "o?",
    categoryId: "c1",
    title: "?",
    description: null,
    url: null,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    headcount: null,
    headcountIsFixed: false,
    startsAt: null,
    endsAt: null,
    externalRef: null,
    status: "PROPOSED",
    version: 0,
    proposerId: "u1",
    proposerName: "Ada",
    materialChangedAt: null,
    createdAt: new Date().toISOString(),
    lockedByName: null,
    lockedAt: null,
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
    ...over,
  };
}

const proposed = opt({ id: "o1", title: "Hostel" });
const locked = opt({
  id: "o2",
  title: "Beach House",
  status: "LOCKED",
  lockedByName: "Ada",
  lockedAt: new Date().toISOString(),
});

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/dashboard")) {
        return json({
          committed: [],
          projected: [],
          lines: [],
          hasStaleHeadcount: false,
          memberCount: 2,
        });
      }
      if (u.includes("/options")) return json([proposed, locked]);
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderBoard(myRole: TripRole) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BoardCanvas
        tripId="t1"
        categories={[category]}
        defaultCurrency="EUR"
        myRole={myRole}
        myUserId="u1"
        frozen={false}
      />
    </QueryClientProvider>,
  );
}

describe("BoardCanvas", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("puts locked options in the Decided column and proposed ones in the lane", async () => {
    mockFetch();
    renderBoard("OWNER");

    // Proposed card is present; the locked one is inside the Decided region.
    expect(await screen.findByText("Hostel")).toBeInTheDocument();
    const decided = screen.getByRole("region", { name: "Decided" });
    expect(within(decided).getByText("Beach House")).toBeInTheDocument();
    // The proposed card is not inside Decided.
    expect(within(decided).queryByText("Hostel")).not.toBeInTheDocument();
  });

  it("shows drag grips for an organizer", async () => {
    mockFetch();
    renderBoard("OWNER");
    await screen.findByText("Hostel");
    expect(
      screen.getAllByRole("button", { name: /drag/i }).length,
    ).toBeGreaterThan(0);
  });

  it("hides drag grips from a non-organizer (participant)", async () => {
    mockFetch();
    renderBoard("PARTICIPANT");
    // Cards still render (and locked stays in Decided), but no drag affordance.
    expect(await screen.findByText("Beach House")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /drag/i })).toBeNull();
  });
});
