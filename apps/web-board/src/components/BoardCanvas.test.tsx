import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { maxCategoryOptions } from "@gtp/types";
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
  paletteKey: null,
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
    participationMode: "WHOLE_GROUP",
    participants: [],
    viewerIsParticipant: false,
    effectiveHeadcount: 4,
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
          viewerCommitted: [],
          viewerPersonal: [],
          personalLines: [],
          lines: [],
          memberCount: 2,
        });
      }
      if (u.includes("/members")) return json(MEMBERS);
      if (u.includes("/options")) return json([proposed, locked]);
      return json({ message: "not found" }, 404);
    }),
  );
}

/**
 * Like {@link mockFetch}, but the lane is at the policy cap — and one of the
 * options is a decision, because the cap counts those too.
 */
function mockFullFetch() {
  const cap = maxCategoryOptions();
  const full = [
    locked,
    ...Array.from({ length: cap - 1 }, (_, i) =>
      opt({ id: `f${i}`, title: `Candidate ${i}` }),
    ),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/dashboard")) {
        return json({
          committed: [],
          projected: [],
          viewerCommitted: [],
          viewerPersonal: [],
          personalLines: [],
          lines: [],
          memberCount: 2,
        });
      }
      if (u.includes("/members")) return json(MEMBERS);
      if (u.includes("/options")) return json(full);
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
          viewerCommitted: [],
          viewerPersonal: [],
          personalLines: [],
          lines: [],
          memberCount: 2,
        });
      }
      if (u.includes("/members")) return json(MEMBERS);
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
        tripDates={null}
        onOpenChannel={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("BoardCanvas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Per-browser view preferences (the cost strip's chart form) persist in
    // localStorage; clear it so one test's choice can't decide what the next
    // one renders.
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

  /**
   * Repainting a lane (post-launch). What matters is the **request**: the
   * endpoint is a full replace, so a colour change has to carry the name and
   * the selection mode with it or picking a colour would quietly rename the
   * lane to nothing and reset how it decides.
   */
  it("sends the lane's other fields along with a new colour", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === "PATCH" && u.includes("/categories/")) {
          sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return json({ ...category, paletteKey: "JADE", version: 1 });
        }
        if (u.includes("/dashboard")) {
          return json({
            committed: [],
            projected: [],
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
            memberCount: 2,
          });
        }
        if (u.includes("/members")) return json(MEMBERS);
        if (u.includes("/options")) return json([proposed, locked]);
        return json({ message: "not found" }, 404);
      }),
    );
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(
      within(lane).getByRole("button", { name: "Stay lane actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change colour" }));

    const dialog = await screen.findByRole("dialog", {
      name: /Colour for Stay/i,
    });
    // The board's own colour is marked before anything is picked, so the dialog
    // opens showing where the lane already stands rather than blank.
    expect(
      within(dialog).getByRole("button", { name: /Amber/ }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: /Jade/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      name: "Stay",
      singleChoice: true,
      paletteKey: "JADE",
      version: 0,
    });
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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

  it("keeps a lane's discussion reachable for a non-organizer", async () => {
    // Discuss moved off its own 💬 button and into the lane's "⋯", which was
    // organizer-only. If the menu had stayed gated, folding the two together
    // would have taken category chat away from everyone else (FR-29).
    mockFetch();
    renderBoard("PARTICIPANT");

    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(
      within(lane).getByRole("button", { name: "Stay lane actions" }),
    );

    expect(screen.getByRole("button", { name: "Discuss" })).toBeVisible();
    // …and nothing a participant would be refused.
    expect(screen.queryByRole("button", { name: "Change colour" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete category" }),
    ).toBeNull();
  });

  it("says a lane is full instead of offering a form the server would refuse", async () => {
    // The cap counts decisions as well as candidates — a locked card is pinned
    // at the top of the lane taking its room — so this lane is full with seven
    // proposals and one decision.
    mockFullFetch();
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(
      await within(lane).findByText(/Full at 8 options/),
    ).toBeInTheDocument();
    // Said rather than silently withheld: the button is gone, but the reason is
    // standing where it was.
    expect(
      within(lane).queryByRole("button", { name: "+ Add card" }),
    ).toBeNull();
  });

  it("still offers the form one option below the cap", async () => {
    // The pair that makes the test above mean something — otherwise a lane that
    // never offered the button at all would pass it.
    mockFetch();
    renderBoard("OWNER");

    const lane = await screen.findByRole("region", { name: "Stay" });
    expect(
      await within(lane).findByRole("button", { name: "+ Add card" }),
    ).toBeVisible();
    expect(within(lane).queryByText(/Full at/)).toBeNull();
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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

  it("draws the lanes in their stored order, all of them draggable", async () => {
    // Two lanes: Stay is settled (a locked card), Food is still open. A "sort
    // by undecided" view used to float Food in front of Stay and remove every
    // lane grip while it did, because the shown order was then not the stored
    // one. Both halves of that are gone: position decides, and a drag is always
    // available to change it.
    const food: CategoryView = {
      id: "c2",
      name: "Food",
      singleChoice: false,
      isBuiltin: true,
      builtinKey: null,
      paletteKey: null,
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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
        />
      </QueryClientProvider>,
    );

    await screen.findByText("Ramen");
    // Stored order: Stay (position 2) before Food (position 3), settled or not.
    expect(
      screen
        .getByRole("heading", { name: "Stay" })
        .compareDocumentPosition(
          screen.getByRole("heading", { name: "Food" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And no view can take the grips away, so a drag is never silently refused.
    expect(
      screen.getAllByRole("button", { name: /drag to reorder the .* lane/i })
        .length,
    ).toBe(2);
    expect(screen.queryByLabelText(/sort lanes/i)).toBeNull();
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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

  /**
   * The same hint, on the one lane where it is circular.
   *
   * Locking a Dates option writes the trip's range, so every rival proposal in
   * that lane then fails the geometric test — by construction, and loudest at
   * the moment someone is reconsidering the dates and has to read past a
   * warning on each alternative.
   */
  it("never tells a date option it is outside the dates it proposes", async () => {
    const dates: CategoryView = {
      id: "cD",
      name: "Dates",
      singleChoice: true,
      isBuiltin: true,
      builtinKey: "DATES",
      paletteKey: null,
      position: 0,
      version: 0,
    };
    // The winner, written back to the trip's range below, and the fortnight
    // nobody chose — still on the board, and none of the app's business.
    const chosen = opt({
      id: "d1",
      categoryId: "cD",
      title: "Week of 6th",
      status: "LOCKED",
      lockedByName: "Ada",
      lockedAt: new Date().toISOString(),
      startsAt: "2026-09-06T00:00:00.000Z",
      endsAt: "2026-09-13T00:00:00.000Z",
    });
    const rival = opt({
      id: "d2",
      categoryId: "cD",
      // Both titles stay under the card's 15-character display cap, so they can
      // be located by their visible text rather than an accessible name.
      title: "Week of 20th",
      startsAt: "2026-09-20T00:00:00.000Z",
      endsAt: "2026-09-27T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/dashboard")) {
          return json({
            committed: [],
            projected: [],
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
            memberCount: 2,
          });
        }
        if (u.includes("/members")) return json(MEMBERS);
        if (u.includes("/options")) return json([chosen, rival]);
        return json({ message: "not found" }, 404);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BoardCanvas
          tripId="t1"
          categories={[dates]}
          defaultCurrency="EUR"
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          tripDates={{
            startDate: "2026-09-06T00:00:00.000Z",
            endDate: "2026-09-13T00:00:00.000Z",
          }}
          onOpenChannel={() => undefined}
        />
      </QueryClientProvider>,
    );

    const lane = await screen.findByRole("region", { name: "Dates" });
    // Both proposals are there and readable; neither is accused of anything.
    expect(within(lane).getByText(/Week of 20th/)).toBeInTheDocument();
    expect(within(lane).queryByText(/outside the trip/)).toBeNull();
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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
      paletteKey: null,
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
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
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

  /**
   * Unlock by drag, as far as jsdom can see it.
   *
   * The strips themselves are only rendered while a card is in hand, and dnd-kit
   * needs real pointer geometry to put one there — so what these assert is the
   * half that survives without layout: that a decision now carries a grip of its
   * own, that it says which of the two gestures it is, and that neither grip
   * appears for a reader who could not do either. The drop is covered end to end
   * by `e2e/drag-to-decide`.
   */
  describe("dragging a decision back out", () => {
    it("gives a settled card a grip that names unlocking", async () => {
      mockFetch();
      renderBoard("OWNER");

      const lane = await screen.findByRole("region", { name: "Stay" });
      // Two grips, two different gestures: a candidate sorts among its
      // neighbours and may be locked, a decision may only be reopened. A
      // settled card had no grip at all until now — it could be locked with
      // the mouse and unlocked only from a menu.
      expect(
        within(lane).getByRole("button", {
          name: /drag hostel .* reorder it/i,
        }),
      ).toBeInTheDocument();
      expect(
        within(lane).getByRole("button", {
          name: /drag beach house .* unlock/i,
        }),
      ).toBeInTheDocument();
    });

    it("hides the settled card's grip from a non-organizer", async () => {
      mockFetch();
      renderBoard("PARTICIPANT");

      const lane = await screen.findByRole("region", { name: "Stay" });
      expect(within(lane).getByText("Beach House")).toBeInTheDocument();
      expect(
        within(lane).queryByRole("button", { name: /drag beach house/i }),
      ).toBeNull();
    });

    it("keeps Unlock on the settled card's menu whether or not drag is on", async () => {
      // Drag is the second way to do a thing, never the only one — the reason
      // this passes for a participant is that they have no menu item either,
      // so the assertion is about an organizer without grips being impossible.
      mockFetch();
      renderBoard("OWNER");

      const lane = await screen.findByRole("region", { name: "Stay" });
      fireEvent.click(
        within(lane).getByRole("button", { name: /actions for beach house/i }),
      );
      expect(
        screen.getByRole("button", { name: "Unlock" }),
      ).toBeInTheDocument();
    });
  });

  /**
   * A refused lane change, in the middle of the screen.
   *
   * The refusal that prompted this is switching a lane to single-select while
   * it holds more than one decision: the server has a rule to explain, and the
   * explanation was a line of red text under the lane's name — in a 15rem
   * column that scrolls, so on a board scrolled anywhere but the top it
   * appeared off the fold the reader was looking at.
   */
  it("puts a refused lane change in a dialog, not a line in the column", async () => {
    const multi: CategoryView = { ...category, singleChoice: false };
    const refusal =
      "This lane has more than one decision. Unlock all but one first.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === "PATCH" && u.includes("/categories/")) {
          return json({ message: refusal }, 409);
        }
        if (u.includes("/dashboard")) {
          return json({
            committed: [],
            projected: [],
            viewerCommitted: [],
            viewerPersonal: [],
            personalLines: [],
            lines: [],
            memberCount: 2,
          });
        }
        if (u.includes("/members")) return json(MEMBERS);
        if (u.includes("/options")) return json([proposed, locked]);
        return json({ message: "not found" }, 404);
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BoardCanvas
          tripId="t1"
          categories={[multi]}
          defaultCurrency="EUR"
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          tripDates={null}
          onOpenChannel={() => undefined}
        />
      </QueryClientProvider>,
    );

    const lane = await screen.findByRole("region", { name: "Stay" });
    fireEvent.click(
      within(lane).getByRole("button", { name: "Stay lane actions" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Allow single-select" }),
    );

    // The server's own words, in the board's one modal shell — and out of the
    // lane, which no longer carries the message anywhere.
    const dialog = await screen.findByRole("dialog", {
      name: /lane wasn’t changed/i,
    });
    expect(within(dialog).getByText(refusal)).toBeInTheDocument();
    expect(within(lane).queryByText(refusal)).toBeNull();

    // And the ✕ every dialog has clears it: the panel and the message are the
    // same fact.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByText(refusal)).not.toBeInTheDocument(),
    );
  });
});
