import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  CategoryView,
  OptionParticipantView,
  OptionView,
  OptionVoterView,
} from "@gtp/types";
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

const joiners = (n: number): OptionParticipantView[] =>
  Array.from({ length: n }, (_, i) => ({
    userId: `p${i}`,
    displayName: `Joiner ${i}`,
    avatarUrl: null,
    joinedAt: "2026-08-01T10:00:00.000Z",
  }));

/**
 * Being in for an option — the replacement for a headcount somebody typed.
 *
 * The rule worth pinning hardest is the *absence*: a whole-group option must
 * not grow a second toggle. Two controls that look alike on every card is how
 * a board stops being readable, and the overwhelming majority of options are
 * for everyone.
 */
describe("OptionCard — who's in", () => {
  it("offers no participation control on a whole-group option", () => {
    renderCard(opt({}));
    expect(screen.queryByRole("button", { name: /i'm in/i })).toBeNull();
    expect(screen.queryByText(/nobody yet/i)).toBeNull();
  });

  it("asks the question rather than reporting nothing, when nobody is in", () => {
    renderCard(opt({ participationMode: "OPT_IN", effectiveHeadcount: 0 }));
    expect(screen.getByText("nobody yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ I'm in" }),
    ).toBeInTheDocument();
  });

  it("draws who is in as faces, and counts the ones that do not fit", () => {
    renderCard(
      opt({
        participationMode: "OPT_IN",
        participants: joiners(7),
        effectiveHeadcount: 7,
      }),
    );
    const who = screen.getByRole("button", { name: /7 in — see who/i });
    expect(within(who).getByTitle("Joiner 0")).toBeInTheDocument();
    // Three fit; the rest become a count rather than shrinking to dots.
    expect(within(who).queryByTitle("Joiner 4")).toBeNull();
    expect(screen.getByText("+4")).toBeInTheDocument();
  });

  it("shows the viewer their own state, pressed", () => {
    renderCard(
      opt({
        participationMode: "OPT_IN",
        participants: joiners(1),
        viewerIsParticipant: true,
        effectiveHeadcount: 1,
      }),
    );
    const btn = screen.getByRole("button", { name: "✓ I'm in" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the vote toggle alongside it, since they say different things", () => {
    // A vote says "we should do this"; being in says "I will pay for this".
    // Both belong on an opt-in card, and neither replaces the other.
    renderCard(opt({ participationMode: "OPT_IN", effectiveHeadcount: 0 }));
    expect(screen.getByRole("button", { name: /vote/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i'm in/i })).toBeInTheDocument();
  });
});

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

/**
 * The decision, said twice.
 *
 * The board's own answer is intensity — a fuller wash and a solid left edge —
 * which is fast to scan and reaches nobody who cannot see it, or who meets one
 * card at a time. The padlock is the same fact in a channel a screen reader can
 * read, so it is labelled rather than hidden like every other glyph on the card.
 */
describe("the decided card's mark", () => {
  it("marks a locked card", () => {
    renderCard(opt({ status: "LOCKED" }));
    expect(screen.getByRole("img", { name: "Decided" })).toBeInTheDocument();
  });

  it("leaves a candidate unmarked", () => {
    renderCard(opt({ status: "PROPOSED" }));
    expect(screen.queryByRole("img", { name: "Decided" })).toBeNull();
  });
  it("keeps the mark in the card's tools, not in front of the title", () => {
    renderCard(opt({ status: "LOCKED" }));
    const mark = screen.getByRole("img", { name: "Decided" });

    // It used to lead the title, inside the run of text that names the card —
    // so a long title wrapped around it and the two read as one phrase. The
    // corner beside the "⋯" is where the card keeps what is true *of* it.
    expect(mark.closest(".lane__card-tools")).not.toBeNull();
    expect(mark.closest("strong")).toBeNull();
  });

  it("leads the tools, with the grip between it and the menu", () => {
    // The order the tools are meant to read in: what this card is, how to move
    // it, what else can be done to it. It matters now that a settled card has a
    // grip at all — the padlock and the grip are the two marks that tell a
    // reader which half of the lane they are looking at.
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OptionCard
          tripId="t1"
          category={category}
          option={opt({ status: "LOCKED" })}
          myRole="OWNER"
          myUserId="u1"
          frozen={false}
          grip={
            <button type="button" aria-label="Drag Beach House">
              ⠿
            </button>
          }
        />
      </QueryClientProvider>,
    );

    const mark = screen.getByRole("img", { name: "Decided" });
    const grip = screen.getByRole("button", { name: "Drag Beach House" });
    const menu = screen.getByRole("button", {
      name: /actions for beach house/i,
    });
    expect(
      mark.compareDocumentPosition(grip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      grip.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
