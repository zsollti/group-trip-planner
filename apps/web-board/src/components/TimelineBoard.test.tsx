import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CategoryView, OptionView } from "@gtp/types";
import { TimelineBoard } from "./TimelineBoard";
import { buildTimeline, type TimelineCandidate } from "../lib/timeline";

/**
 * The layout arithmetic is covered in `lib/timeline.test.ts`; what is worth
 * asserting here is the promise the page makes to a reader — that a stay is
 * drawn **once** rather than repeated into every night it covers, and that a
 * decision it could not place is still on the screen somewhere. Functional/DOM
 * only (no screenshot tests), so the grid geometry itself is checked as the
 * inline `grid-row` a span claims rather than by measuring anything.
 */

const stay: CategoryView = {
  id: "c-stay",
  name: "Stay",
  singleChoice: false,
  isBuiltin: true,
  builtinKey: "ACCOMMODATION",
  paletteKey: null,
  position: 1,
  version: 0,
};
const doing: CategoryView = {
  ...stay,
  id: "c-do",
  name: "Activities",
  builtinKey: "ACTIVITIES",
  paletteKey: null,
};

function option(over: Partial<OptionView>): OptionView {
  return {
    id: `o-${over.title ?? "x"}`,
    categoryId: "c",
    title: "Untitled",
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
    status: "LOCKED",
    version: 0,
    proposerId: "u1",
    proposerName: "Ada",
    materialChangedAt: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    lockedByName: "Ada",
    lockedAt: "2026-06-02T10:00:00.000Z",
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
    ...over,
  };
}

const item = (
  category: CategoryView,
  over: Partial<OptionView>,
): TimelineCandidate => ({
  option: option(over),
  category,
});

/** As the API serves them: bare calendar days at midnight UTC. */
const tripDates = {
  startDate: "2026-07-03T00:00:00.000Z",
  endDate: "2026-07-10T00:00:00.000Z",
};

/** The props that are not what any of these tests are about. */
const chrome = {
  tripId: "t-1",
  categories: [stay, doing],
  defaultCurrency: "EUR",
  canPropose: false,
  onProposed: () => undefined,
};

function renderTimeline(candidates: TimelineCandidate[]) {
  return render(
    <TimelineBoard
      timeline={buildTimeline(candidates, tripDates)}
      tripDates={tripDates}
      {...chrome}
    />,
  );
}

describe("TimelineBoard", () => {
  it("draws a stay once, spanning the nights it covers", () => {
    // The failure this guards is the day-by-day agenda one: a hotel repeated
    // into every day section, which buries the things that actually happen.
    const { container } = renderTimeline([
      item(stay, {
        title: "Hotel Luna",
        startsAt: "2026-07-03T15:00",
        endsAt: "2026-07-06T10:00",
      }),
    ]);
    expect(screen.getAllByText("Hotel Luna")).toHaveLength(1);
    expect(screen.getByText("3 nights")).toBeInTheDocument();
    const span = container.querySelector(".tl__span");
    // Rows 1..4 of the spine — Jul 3 through Jul 6 inclusive.
    expect(span).toHaveStyle({ gridRow: "1 / 5" });
  });

  it("puts a same-day thing in its own day, with its clock time", () => {
    // Found by `data-day`, never by the heading text: this suite runs under
    // whatever locale the machine has (Hungarian, here), so asserting on a
    // formatted date passes in one place and fails in another.
    const { container } = renderTimeline([
      item(doing, {
        title: "Diocletian's Palace",
        startsAt: "2026-07-04T10:00",
        endsAt: "2026-07-04T12:00",
      }),
    ]);
    const day = container.querySelector('[data-day="2026-07-04"]');
    expect(day).not.toBeNull();
    const inDay = within(day as HTMLElement);
    expect(inDay.getByText("Diocletian's Palace")).toBeInTheDocument();
    // The time of day is the point of a moment, so it leads the card.
    expect(inDay.getByText(/10:00.*12:00/)).toBeInTheDocument();
  });

  it("shows an undated decision in the tray instead of dropping it", () => {
    renderTimeline([
      item(stay, { title: "Some hostel" }),
      item(doing, {
        title: "Museum",
        startsAt: "2026-07-04T10:00",
        endsAt: "2026-07-04T12:00",
      }),
    ]);
    const tray = screen.getByRole("region", { name: /not on the timeline/i });
    expect(within(tray).getByText("Some hostel")).toBeInTheDocument();
    expect(within(tray).getByText("No dates yet")).toBeInTheDocument();
    // And it did not quietly become part of the itinerary.
    expect(within(tray).queryByText("Museum")).not.toBeInTheDocument();
  });

  it("sets a wrong-month booking aside rather than stretching the axis", () => {
    renderTimeline([
      item(stay, {
        title: "March hotel",
        startsAt: "2026-03-03T15:00",
        endsAt: "2026-03-06T10:00",
      }),
    ]);
    const tray = screen.getByRole("region", { name: /not on the timeline/i });
    expect(within(tray).getByText("March hotel")).toBeInTheDocument();
    expect(
      screen.getByText(/outside the trip's own dates/i),
    ).toBeInTheDocument();
    // Eight day rows, not five months of them.
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(8);
  });

  it("keeps the flight home on the spine and marks the day it overhangs", () => {
    renderTimeline([
      item(doing, {
        title: "Flight home",
        startsAt: "2026-07-10T23:30",
        endsAt: "2026-07-11T06:10",
      }),
    ]);
    expect(
      screen.queryByRole("region", { name: /not on the timeline/i }),
    ).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(9);
    expect(screen.getByText(/outside the trip's dates/i)).toBeInTheDocument();
    expect(screen.getByText("Flight home")).toBeInTheDocument();
  });

  it("says a day is empty rather than leaving a blank", () => {
    renderTimeline([
      item(doing, {
        title: "Museum",
        startsAt: "2026-07-04T10:00",
        endsAt: "2026-07-04T12:00",
      }),
    ]);
    // On the day's own heading line, so a free day takes a short row rather
    // than standing as tall as a day with plans in it.
    expect(screen.getAllByText("nothing planned")).toHaveLength(7);
  });

  it("offers the board when nothing is decided at all", () => {
    render(
      <TimelineBoard
        timeline={buildTimeline([], null)}
        tripDates={null}
        {...chrome}
      />,
    );
    expect(
      screen.getByText(/lock an option on the board/i),
    ).toBeInTheDocument();
  });

  it("draws a proposal subordinate to the decisions around it", () => {
    // The overlay's whole job is to be distinguishable at a glance. If a
    // candidate rendered identically to a locked option, six candidates in a
    // multi-select lane would read as six things that are all happening.
    const { container } = renderTimeline([
      item(doing, {
        title: "Settled dinner",
        startsAt: "2026-07-04T20:00",
        endsAt: "2026-07-04T22:00",
      }),
      item(doing, {
        title: "Maybe a museum",
        status: "PROPOSED",
        startsAt: "2026-07-04T10:00",
        endsAt: "2026-07-04T12:00",
      }),
    ]);
    const cards = container.querySelectorAll(".tl__card--moment");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toContain("tl__card--proposed");
    expect(cards[1]?.className).not.toContain("tl__card--proposed");
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("marks the night nobody booked, on the day it belongs to", () => {
    const { container } = renderTimeline([
      item(stay, {
        title: "Split",
        startsAt: "2026-07-03T15:00",
        endsAt: "2026-07-06T10:00",
      }),
      item(stay, {
        title: "Hvar",
        startsAt: "2026-07-07T15:00",
        endsAt: "2026-07-10T10:00",
      }),
    ]);
    const gaps = container.querySelectorAll(".tl__gap");
    expect(gaps).toHaveLength(1);
    // In the Jul 6 row, not the gutter — the departing stay still occupies
    // that gutter row, so a marker there would land under its own card.
    const day = container.querySelector('[data-day="2026-07-06"]');
    expect(day?.querySelector(".tl__gap")).not.toBeNull();
  });

  it("names the clash on both decisions involved", () => {
    renderTimeline([
      item(doing, {
        title: "Museum",
        startsAt: "2026-07-04T10:00",
        endsAt: "2026-07-04T12:00",
      }),
      item(doing, {
        title: "Boat trip",
        startsAt: "2026-07-04T11:00",
        endsAt: "2026-07-04T15:00",
      }),
    ]);
    expect(
      screen.getAllByText(/overlaps another activities decision/i),
    ).toHaveLength(2);
  });

  it("warns that a derived axis will move under the reader", () => {
    render(
      <TimelineBoard
        timeline={buildTimeline(
          [
            item(doing, {
              title: "Museum",
              startsAt: "2026-07-04T10:00",
              endsAt: "2026-07-04T12:00",
            }),
          ],
          null,
        )}
        tripDates={null}
        {...chrome}
      />,
    );
    expect(screen.getByText(/dates aren't settled yet/i)).toBeInTheDocument();
  });
});
