import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, OptionView, OptionVoterView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { OptionCard } from "./OptionCard";

/**
 * The option card — functional/DOM only (no screenshot tests).
 *
 * These cover the readability pass: a card carries what you scan a lane *for*,
 * and everything else is one click away in the detail dialog. Specifically that
 * the vote tally names people rather than counting dots, that it stops at three
 * faces and offers the rest as a list, and that the proposer is no longer a
 * line of noise between the price and the votes.
 */

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

function voter(over: Partial<OptionVoterView>): OptionVoterView {
  return {
    userId: "u?",
    displayName: "?",
    avatarUrl: null,
    votedAt: "2026-08-01T10:00:00.000Z",
    stale: false,
    ...over,
  };
}

function opt(over: Partial<OptionView>): OptionView {
  return {
    id: "o1",
    categoryId: "c1",
    title: "Beach House",
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
    createdAt: "2026-08-01T09:00:00.000Z",
    lockedByName: null,
    lockedAt: null,
    voteCount: 0,
    voters: [],
    viewerHasVoted: false,
    ...over,
  };
}

function renderCard(option: OptionView) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <OptionCard
        tripId="t1"
        category={category}
        option={option}
        myRole="OWNER"
        myUserId="u1"
        frozen={false}
      />
    </QueryClientProvider>,
  );
}

const people = (n: number): OptionVoterView[] =>
  Array.from({ length: n }, (_, i) =>
    voter({ userId: `u${i}`, displayName: `Voter ${i}` }),
  );

describe("OptionCard", () => {
  it("says so plainly when nobody has voted", () => {
    renderCard(opt({}));
    expect(screen.getByText("no votes")).toBeInTheDocument();
  });

  it("shows every voter as a face while they fit", () => {
    renderCard(opt({ voters: people(3), voteCount: 3 }));

    const tally = screen.getByRole("button", { name: /3 votes — see who/i });
    // Each face carries its person's name on `title`, so a hover identifies
    // them without opening anything.
    expect(within(tally).getByTitle("Voter 0")).toBeInTheDocument();
    expect(within(tally).getByTitle("Voter 2")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("counts the voters that do not fit instead of shrinking them", () => {
    renderCard(opt({ voters: people(7), voteCount: 7 }));

    const tally = screen.getByRole("button", { name: /7 votes — see who/i });
    expect(within(tally).getByTitle("Voter 0")).toBeInTheDocument();
    // Four of seven are behind the count.
    expect(within(tally).queryByTitle("Voter 3")).toBeNull();
    expect(within(tally).getByText("+4")).toBeInTheDocument();
  });

  it("opens the full voter list from the tally", () => {
    renderCard(opt({ voters: people(7), voteCount: 7 }));

    fireEvent.click(screen.getByRole("button", { name: /7 votes — see who/i }));

    const dialog = screen.getByRole("dialog", { name: /7 voted/i });
    // Everyone, by name — the point of the list is that the stack cannot show
    // more than three.
    expect(within(dialog).getByText("Voter 0")).toBeInTheDocument();
    expect(within(dialog).getByText("Voter 6")).toBeInTheDocument();
  });

  it("says in words that a vote predates the last change", () => {
    // The stale rule (FR-23) used to ride on a hollow dot with a `title`. It
    // still counts — it just no longer means what it meant — so the list says
    // that rather than relying on a visual treatment with no legend.
    renderCard(
      opt({
        voters: [voter({ userId: "u9", displayName: "Grace", stale: true })],
        voteCount: 1,
        materialChangedAt: "2026-08-02T10:00:00.000Z",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /1 vote — see who/i }));

    expect(
      screen.getByText(/voted before the last change/i),
    ).toBeInTheDocument();
  });

  it("keeps the proposer off the card and in the detail dialog", () => {
    renderCard(opt({ description: "Right on the beach" }));

    expect(screen.queryByText(/by Ada/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /view details/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Proposed by")).toBeInTheDocument();
    expect(within(dialog).getByText("Ada")).toBeInTheDocument();
  });
});
