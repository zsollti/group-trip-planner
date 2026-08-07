import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

/** Like {@link mockFetch}, but the category has no options at all. */
function mockEmptyFetch() {
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
      if (u.includes("/options")) return json([]);
      return json({ message: "not found" }, 404);
    }),
  );
}

function renderBoard(myRole: TripRole, frozen = false) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BoardCanvas
        tripId="t1"
        categories={[category]}
        defaultCurrency="EUR"
        myRole={myRole}
        myUserId="u1"
        frozen={frozen}
        onOpenChannel={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("BoardCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The lane-sort preference persists in localStorage; clear it so one test's
    // choice can't set the starting order for the next.
    window.localStorage.clear();
  });

  it("puts locked options in the Decided rail and proposed ones in the lane", async () => {
    mockFetch();
    renderBoard("OWNER");

    // Proposed card is present; the locked one is inside the Decided region.
    expect(await screen.findByText("Hostel")).toBeInTheDocument();
    const decided = screen.getByRole("region", { name: "Decided" });
    expect(within(decided).getByText("Beach House")).toBeInTheDocument();
    // The proposed card is not inside Decided.
    expect(within(decided).queryByText("Hostel")).not.toBeInTheDocument();
  });

  it("names the category each decision answers, since the rail is cross-lane", async () => {
    // The rail collects decisions from every lane, so a chip that only said
    // "Beach House" would not say which question it settled. The lane it came
    // from can no longer supply that context by position.
    mockFetch();
    renderBoard("OWNER");

    const decided = await screen.findByRole("region", { name: "Decided" });
    expect(within(decided).getByText("Stay")).toBeInTheDocument();
  });

  it("keeps unlock reachable without a drag", async () => {
    // Drag-to-unlock is progressive enhancement; the menu is the keyboard and
    // touch path, and it is the only one jsdom can exercise.
    mockFetch();
    renderBoard("OWNER");

    const decided = await screen.findByRole("region", { name: "Decided" });
    fireEvent.click(
      within(decided).getByRole("button", { name: /actions for beach house/i }),
    );

    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("offers a viewer with no decision rights no unlock", async () => {
    mockFetch();
    renderBoard("PARTICIPANT");

    const decided = await screen.findByRole("region", { name: "Decided" });
    fireEvent.click(
      within(decided).getByRole("button", { name: /actions for beach house/i }),
    );

    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    // But the decision is still readable in full.
    expect(
      screen.getByRole("button", { name: "View details" }),
    ).toBeInTheDocument();
  });

  it("says what the rail is for while it is still empty", async () => {
    mockEmptyFetch();
    renderBoard("OWNER");

    const decided = await screen.findByRole("region", { name: "Decided" });
    expect(
      within(decided).getByText(/nothing settled yet/i),
    ).toBeInTheDocument();
  });

  it("turns an empty lane into a propose CTA that opens the form (Phase 6.4)", async () => {
    mockEmptyFetch();
    renderBoard("PARTICIPANT");

    const cta = await screen.findByRole("button", {
      name: /propose the first option/i,
    });
    fireEvent.click(cta);

    expect(
      await screen.findByRole("dialog", { name: /propose an option/i }),
    ).toBeInTheDocument();
  });

  it("explains an empty lane instead of offering a CTA that would fail", async () => {
    // A Guest may not propose, and a frozen board accepts nothing — neither
    // should be handed an action the server would refuse.
    mockEmptyFetch();
    renderBoard("GUEST");

    expect(await screen.findByText("No options yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /propose the first option/i }),
    ).not.toBeInTheDocument();
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

  it("orders proposed cards by vote count, most-voted first", async () => {
    const low = opt({ id: "o1", title: "Hostel", voteCount: 1 });
    const high = opt({ id: "o3", title: "Villa", voteCount: 3 });
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
        // Server returns position order (low first); the board re-sorts by votes.
        if (u.includes("/options")) return json([low, high]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("OWNER");

    const villa = await screen.findByText("Villa");
    const hostel = screen.getByText("Hostel");
    // Villa (3 votes) is rendered before Hostel (1 vote) despite the server order.
    expect(
      villa.compareDocumentPosition(hostel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sorting by undecided reorders the lanes and stands lane drag down", async () => {
    // Two lanes: Stay is settled (a locked card), Food is still open.
    const food: CategoryView = {
      id: "c2",
      name: "Food",
      singleChoice: false,
      isBuiltin: true,
      builtinKey: null,
      position: 3,
      version: 0,
    };
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
        if (u.includes("/categories/c1/options")) return json([locked]);
        if (u.includes("/categories/c2/options"))
          return json([opt({ id: "o3", categoryId: "c2", title: "Ramen" })]);
        return json({ message: "not found" }, 404);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BoardCanvas
          tripId="t1"
          categories={[category, food]}
          defaultCurrency="EUR"
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          onOpenChannel={() => undefined}
        />
      </QueryClientProvider>,
    );

    await screen.findByText("Ramen");
    const laneGrip = /drag to reorder the .* lane/i;
    // Manual order: the stored positions, and lanes are draggable.
    expect(screen.getAllByRole("button", { name: laneGrip }).length).toBe(2);
    const stay = screen.getByRole("heading", { name: "Stay" });
    expect(
      stay.compareDocumentPosition(
        screen.getByRole("heading", { name: "Food" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/sort lanes/i), {
      target: { value: "undecided" },
    });

    // Food (open) now precedes Stay (decided) — and because the shown order is
    // no longer the stored one, the lane grips are gone so a drag can't reorder
    // against indices the server doesn't share.
    expect(
      screen
        .getByRole("heading", { name: "Food" })
        .compareDocumentPosition(
          screen.getByRole("heading", { name: "Stay" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: laneGrip })).toBeNull();
  });

  it("opens a read-only detail view for a locked card with its category and full notes", async () => {
    const lockedFull = opt({
      id: "o2",
      title: "Beach House",
      status: "LOCKED",
      lockedByName: "Ada",
      lockedAt: new Date().toISOString(),
      description: "Sleeps eight, sea view, two-night minimum.",
    });
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
        if (u.includes("/options")) return json([lockedFull]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("PARTICIPANT");

    // A participant can't edit a locked card, so the title opens the detail view.
    fireEvent.click(await screen.findByText("Beach House"));
    // Since Phase 6.3 every dialog is named by its visible heading (rendered by
    // the shared Dialog and wired with aria-labelledby), not a separate
    // aria-label that could drift from it.
    const dialog = await screen.findByRole("dialog", { name: /Beach House/i });
    expect(within(dialog).getByText("Stay")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Sleeps eight, sea view/),
    ).toBeInTheDocument();
  });
});
