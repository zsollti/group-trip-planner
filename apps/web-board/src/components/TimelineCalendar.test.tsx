import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CategoryView, OptionView } from "@gtp/types";
import { TimelineBoard } from "./TimelineBoard";
import { buildTimeline, type TimelineCandidate } from "../lib/timeline";

/**
 * Proposing from an empty hour of the week grid.
 *
 * The calendar is the only surface in the app that shows a free Thursday
 * morning, and until now noticing one led nowhere: the reader had to leave,
 * find the right lane, open its form and type the day and the hour back in by
 * hand. A click on the hour carries both — which leaves exactly one question a
 * grid cannot answer, and that is the field the form opens on.
 *
 * The grid is the wide layout, so `matchMedia` has to be answered here; jsdom
 * has none, and `useMediaQuery` deliberately reads that as "narrow" (see
 * `lib/media.ts`), which is why every other timeline test gets the spine.
 */

const proposed: unknown[] = [];

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useProposeOption: () => ({
      isPending: false,
      mutateAsync: (body: unknown) => {
        proposed.push(body);
        return Promise.resolve({});
      },
      // The form holds both hooks whichever way it was opened.
    }),
    useEditOption: () => ({
      isPending: false,
      mutateAsync: () => Promise.resolve({}),
    }),
  };
});

const doing: CategoryView = {
  id: "c-do",
  name: "Activities",
  singleChoice: false,
  isBuiltin: true,
  builtinKey: "ACTIVITIES",
  paletteKey: null,
  position: 1,
  version: 0,
};
const stay: CategoryView = {
  ...doing,
  id: "c-stay",
  name: "Stay",
  builtinKey: "ACCOMMODATION",
};

function option(over: Partial<OptionView>): OptionView {
  return {
    id: "o-1",
    categoryId: "c-do",
    title: "Museum",
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
  } as OptionView;
}

/** Three days, with one decision on the middle one. */
const tripDates = {
  startDate: "2026-07-03T00:00:00.000Z",
  endDate: "2026-07-05T00:00:00.000Z",
};
const candidates: TimelineCandidate[] = [
  {
    category: doing,
    option: option({
      startsAt: "2026-07-04T14:00",
      endsAt: "2026-07-04T16:00",
    }),
  },
];

const onProposed = vi.fn();

function renderCalendar(canPropose = true) {
  return render(
    <TimelineBoard
      timeline={buildTimeline(candidates, tripDates)}
      tripDates={tripDates}
      tripId="t-1"
      categories={[doing, stay]}
      defaultCurrency="EUR"
      canPropose={canPropose}
      onProposed={onProposed}
    />,
  );
}

describe("proposing from an empty hour", () => {
  beforeEach(() => {
    proposed.length = 0;
    onProposed.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens the propose form on the hour that was clicked", () => {
    renderCalendar();
    // The grid's default window starts at 08:00, so the first empty hour of
    // the first day is 08:00 on 3 July.
    const slots = screen.getAllByRole("button", {
      name: /^Propose something at/,
    });
    expect(slots.length).toBeGreaterThan(0);
    fireEvent.click(slots[0]!);

    // The two things the click knew, already answered.
    expect(screen.getByLabelText("Start time")).toHaveValue("08:00");
    expect(screen.getByLabelText("End time")).toHaveValue("09:00");
  });

  it("asks which lane, because an hour cannot say", () => {
    renderCalendar();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Propose something at/ })[0]!,
    );

    const lane = screen.getByLabelText("Lane");
    expect(lane).toBeInTheDocument();
    // Every lane the calendar draws, and the reader may change it before
    // saving — a form opened from a lane has no such field at all.
    expect(screen.getByRole("option", { name: "Activities" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Stay" })).toBeVisible();
  });

  it("proposes into the lane that was chosen, at that hour", async () => {
    renderCalendar();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Propose something at/ })[0]!,
    );
    fireEvent.change(screen.getByLabelText("Lane"), {
      target: { value: "c-stay" },
    });
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Breakfast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose option" }));

    // Awaited so the dialog has finished closing before the test ends — the
    // body lands synchronously, the unmount that follows it does not.
    await waitFor(() => expect(proposed).toHaveLength(1));
    const { title, startsAt } = proposed[0] as {
      title: string;
      startsAt: string;
    };
    expect(title).toBe("Breakfast");
    const at = new Date(startsAt);
    expect(at.getHours()).toBe(8);
    expect(at.getDate()).toBe(3);
  });

  it("tells the view to draw proposals, or the new card is invisible", async () => {
    // The overlay is off by default, so without this the reader fills in a
    // form, saves, and the hour is empty again — indistinguishable from the
    // save having failed.
    renderCalendar();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Propose something at/ })[0]!,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Breakfast" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose option" }));

    // After the save resolves, not on the click: the callback is what the
    // proposal actually landing sounds like.
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
  });

  it("leaves the hours inert for a reader who may not propose", () => {
    // A guest, or a board that has ended. The grid still reads exactly the
    // same; it simply offers nothing.
    renderCalendar(false);
    expect(
      screen.queryAllByRole("button", { name: /^Propose something at/ }),
    ).toHaveLength(0);
  });
});
