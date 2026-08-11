import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, OptionView, TripRole } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { BoardCanvas } from "./BoardCanvas";

/**
 * Board canvas (Phase 3.5) — functional/DOM tests (no screenshot tests). Real
 * pointer-drag is progressive enhancement jsdom can't drive, so these assert
 * what does not need a live drag: that a decision and the options it beat sit
 * together in their lane, that every drag gesture has a menu equivalent, that
 * the grips appear only for organizers on an active trip, and that the summary
 * band names the crew. The drag itself is covered by `e2e/drag-to-decide`.
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

/** The crew panel in the summary band reads this. */
const MEMBERS = {
  members: [
    {
      userId: "u1",
      displayName: "Ada",
      role: "OWNER",
      avatarUrl: null,
      joinedAt: new Date().toISOString(),
    },
    {
      userId: "u2",
      displayName: "Grace",
      role: "PARTICIPANT",
      avatarUrl: null,
      joinedAt: new Date().toISOString(),
    },
  ],
  blocked: [],
};

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
      if (u.includes("/members")) return json(MEMBERS);
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
      if (u.includes("/members")) return json(MEMBERS);
      if (u.includes("/options")) return json([]);
      return json({ message: "not found" }, 404);
    }),
  );
}

const onManageMembers = vi.fn();

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
        tripDates={null}
        onOpenChannel={() => undefined}
        onManageMembers={onManageMembers}
      />
    </QueryClientProvider>,
  );
}

describe("BoardCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    onManageMembers.mockClear();
    // The lane-sort preference persists in localStorage; clear it so one test's
    // choice can't set the starting order for the next.
    window.localStorage.clear();
  });

  it("keeps a decision in its lane, beside the option it beat", async () => {
    // The lane is the comparison: what we picked, and what we picked it over.
    // A decision used to leave for the Decided rail, so a lane showed only the
    // options a group rejected. There is one copy now and this is it.
    mockFetch();
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(within(lane).getByText("Beach House")).toBeInTheDocument();
    expect(within(lane).getByText("Hostel")).toBeInTheDocument();
  });

  it("no longer renders a Decided rail", async () => {
    // Guards the removal, not the absence of a feature: the rail was a second
    // copy of every decision sitting directly above the first, and a stray
    // re-introduction would be invisible in every other test here.
    mockFetch();
    renderBoard("OWNER");

    await screen.findByText("Hostel");
    expect(screen.queryByRole("region", { name: "Decided" })).toBeNull();
  });

  it("does not call a lane holding a decision empty", async () => {
    // The defect this fixes: a lane whose only option was locked fell into the
    // empty state and offered "Propose the first option" — the new-board CTA,
    // on a question that had just been answered.
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
        if (u.includes("/members")) return json(MEMBERS);
        if (u.includes("/options")) return json([locked]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(within(lane).getByText("Beach House")).toBeInTheDocument();
    expect(
      within(lane).queryByRole("button", { name: /propose the first option/i }),
    ).toBeNull();
  });

  it("does not tell an ended trip that a settled lane decided nothing", async () => {
    // The same defect at its most misleading: a frozen board rendered "Nothing
    // was decided here" on a lane where something plainly was.
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
        if (u.includes("/members")) return json(MEMBERS);
        if (u.includes("/options")) return json([locked]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("OWNER", true);

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(within(lane).getByText("Beach House")).toBeInTheDocument();
    expect(within(lane).queryByText("Nothing was decided here")).toBeNull();
  });

  it("keeps unlock reachable without a drag", async () => {
    // Dragging a chip out of the rail used to be the other way to reopen a
    // decision. With the rail gone this menu is the *only* way, so it is no
    // longer an equivalent for a gesture — it is the path.
    mockFetch();
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(
      within(lane).getByRole("button", { name: /actions for beach house/i }),
    );

    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("offers a viewer with no decision rights no unlock", async () => {
    mockFetch();
    renderBoard("PARTICIPANT");

    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(
      within(lane).getByRole("button", { name: /actions for beach house/i }),
    );

    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    // But the decision is still readable in full.
    expect(
      screen.getByRole("button", { name: "View details" }),
    ).toBeInTheDocument();
  });

  it("names the crew and their roles in the summary band", async () => {
    // What the band is for now: the lanes below can be read for what the trip
    // has decided, but not for who is deciding it.
    mockFetch();
    renderBoard("OWNER");

    const crew = await screen.findByRole("region", { name: "Crew" });
    // The panel renders straight away with its loading state, so the region
    // being present says nothing — wait for the roster itself.
    expect(await within(crew).findByText(/Ada/)).toBeInTheDocument();
    expect(within(crew).getByText("Grace")).toBeInTheDocument();
    expect(within(crew).getByText("Participant")).toBeInTheDocument();
  });

  it("sends an organizer from the crew panel to the members dialog", async () => {
    // The panel is read-only by design — roles, kicks and blocks are
    // consequential and stay behind a deliberate click.
    mockFetch();
    renderBoard("OWNER");

    const crew = await screen.findByRole("region", { name: "Crew" });
    fireEvent.click(within(crew).getByRole("button", { name: "Manage" }));

    expect(onManageMembers).toHaveBeenCalledTimes(1);
  });

  it("offers a participant a way to see the crew, not to change it", async () => {
    mockFetch();
    renderBoard("PARTICIPANT");

    const crew = await screen.findByRole("region", { name: "Crew" });
    expect(within(crew).getByRole("button", { name: "View" })).toBeVisible();
    expect(within(crew).queryByRole("button", { name: "Manage" })).toBeNull();
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
    // Cards still render — everything stays readable without decision rights;
    // there is simply no drag affordance anywhere.
    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(within(lane).getByText("Beach House")).toBeInTheDocument();
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
          tripDates={null}
          onOpenChannel={() => undefined}
          onManageMembers={onManageMembers}
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

    // A participant can't edit a locked card, so the title opens the detail
    // view. Reached from the lane copy — the rail chip opens the same dialog.
    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(within(lane).getByText("Beach House"));
    // Since Phase 6.3 every dialog is named by its visible heading (rendered by
    // the shared Dialog and wired with aria-labelledby), not a separate
    // aria-label that could drift from it.
    const dialog = await screen.findByRole("dialog", { name: /Beach House/i });
    expect(within(dialog).getByText("Stay")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Sleeps eight, sea view/),
    ).toBeInTheDocument();
  });

  /**
   * The advisory hint. Once the trip's dates are settled, an option's dates say
   * *when within the trip* — so one booked for the wrong month is worth
   * pointing at, on the card and on the chip that repeats it in the rail.
   * Nothing rejects it: the option renders normally and keeps every action.
   */
  it("flags an option whose dates fall outside the settled trip", async () => {
    const march = opt({
      id: "o3",
      title: "Wrong Month Inn",
      startsAt: "2026-03-06T14:00:00.000Z",
      endsAt: "2026-03-09T10:00:00.000Z",
    });
    const during = opt({
      id: "o4",
      title: "Right Week Inn",
      startsAt: "2026-09-08T14:00:00.000Z",
      endsAt: "2026-09-10T10:00:00.000Z",
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
        if (u.includes("/options")) return json([march, during]);
        return json({ message: "not found" }, 404);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BoardCanvas
          tripId="t1"
          categories={[category]}
          defaultCurrency="EUR"
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          tripDates={{
            startDate: "2026-09-06T12:00:00.000Z",
            endDate: "2026-09-13T12:00:00.000Z",
          }}
          onOpenChannel={() => undefined}
          onManageMembers={onManageMembers}
        />
      </QueryClientProvider>,
    );

    const lane = await screen.findByRole("region", { name: "Stay" });
    const flagged = within(lane)
      .getByText(/Wrong Month Inn/)
      .closest("article");
    expect(flagged).not.toBeNull();
    expect(
      within(flagged as HTMLElement).getByText(/outside the trip/),
    ).toBeInTheDocument();

    // The option overlapping the trip says nothing — a warning shown on a
    // correct option teaches people to ignore warnings.
    const fine = within(lane)
      .getByText(/Right Week Inn/)
      .closest("article");
    expect(
      within(fine as HTMLElement).queryByText(/outside the trip/),
    ).toBeNull();
  });

  it("says nothing about any option while the trip has no dates", async () => {
    // With no trip range there is nothing to be outside of, so the same card
    // that was flagged above must render clean.
    const march = opt({
      id: "o3",
      title: "Wrong Month Inn",
      startsAt: "2026-03-06T14:00:00.000Z",
      endsAt: "2026-03-09T10:00:00.000Z",
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
        if (u.includes("/options")) return json([march]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(within(lane).getByText(/Wrong Month Inn/)).toBeInTheDocument();
    expect(screen.queryByText(/outside the trip/)).toBeNull();
  });

  it("keeps a multi-select lane addable once every option is locked", async () => {
    // The dead end: a lane holding only decisions is not *empty*, so it gets no
    // ghost CTA, and it has no proposed cards, so it used to get no button
    // either — leaving a lane you are expressly meant to keep adding to with
    // nowhere to add. The single-choice lane beside it is the control: that
    // question has its answer, and reconsidering starts by unlocking.
    const activities: CategoryView = {
      id: "c2",
      name: "Activities",
      singleChoice: false,
      isBuiltin: true,
      builtinKey: "ACTIVITIES",
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
        // Both lanes hold exactly one locked option and nothing proposed.
        if (u.includes("/categories/c1/options")) return json([locked]);
        if (u.includes("/categories/c2/options"))
          return json([
            opt({
              id: "o3",
              categoryId: "c2",
              title: "Boat trip",
              status: "LOCKED",
              lockedByName: "Ada",
              lockedAt: new Date().toISOString(),
            }),
          ]);
        return json({ message: "not found" }, 404);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BoardCanvas
          tripId="t1"
          categories={[category, activities]}
          defaultCurrency="EUR"
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          tripDates={null}
          onOpenChannel={() => undefined}
          onManageMembers={onManageMembers}
        />
      </QueryClientProvider>,
    );

    const multi = await screen.findByRole("region", { name: "Activities" });
    expect(
      within(multi).getByRole("button", { name: /add card/i }),
    ).toBeInTheDocument();

    const single = await screen.findByRole("region", { name: "Stay" });
    expect(
      within(single).queryByRole("button", { name: /add card/i }),
    ).toBeNull();
  });
});
