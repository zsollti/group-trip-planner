import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { AnswerPanel, type Answerer } from "./AnswerPanel";

/**
 * The panel behind a stack of faces, which used to answer half the question.
 *
 * "Three voted" is a fact and not a decision: whether to wait or to lock turns
 * entirely on whether three is everybody, and the reader had to go and count the
 * crew themselves to find out. So the denominator, and — the part that actually
 * ends the waiting — the names it is missing.
 */

const MEMBERS = {
  members: [
    { userId: "u-ada", displayName: "Ada", avatarUrl: null, role: "OWNER" },
    {
      userId: "u-bo",
      displayName: "Bo",
      avatarUrl: null,
      role: "PARTICIPANT",
    },
    {
      userId: "u-cy",
      displayName: "Cy",
      avatarUrl: null,
      role: "CO_ORGANIZER",
    },
    // A Guest may read the board and talk on it, and may not vote. Counting
    // them would leave a fully-decided option perpetually short of an answer.
    { userId: "u-di", displayName: "Di", avatarUrl: null, role: "GUEST" },
  ],
  blocked: [],
};

function panel(answered: Answerer[]) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AnswerPanel
        tripId="t-1"
        answered={answered}
        title={(n, total) =>
          total === null ? `${n} voted` : `${n} / ${total} voted`
        }
        pendingLabel="Yet to vote"
        doneLabel="Everyone has voted."
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

const ADA: Answerer = {
  userId: "u-ada",
  displayName: "Ada",
  avatarUrl: null,
};

describe("AnswerPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(MEMBERS), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts the answers against everyone who may give one", async () => {
    panel([ADA]);
    // Three of the four can vote, so one of three has — not one of four, and
    // certainly not the bare "1" this said before.
    expect(
      await screen.findByRole("heading", { name: "1 / 3 voted" }),
    ).toBeInTheDocument();
  });

  it("names the people still to answer", async () => {
    panel([ADA]);
    expect(await screen.findByText("Yet to vote")).toBeInTheDocument();
    // The two who have not, by name — "who are we waiting for" is the next
    // question every time, and the board already knows.
    expect(screen.getByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("Cy")).toBeInTheDocument();
    // …and not the Guest, who was never being waited for.
    expect(screen.queryByText("Di")).toBeNull();
  });

  it("says so when there is nobody left to wait for", async () => {
    panel([
      ADA,
      { userId: "u-bo", displayName: "Bo", avatarUrl: null },
      { userId: "u-cy", displayName: "Cy", avatarUrl: null },
    ]);
    expect(await screen.findByText("Everyone has voted.")).toBeInTheDocument();
    expect(screen.queryByText("Yet to vote")).toBeNull();
  });

  it("says the half it knows while the roster is still coming", () => {
    panel([ADA]);
    // Before the request lands there is no denominator, and "1 / 0 voted" would
    // be a worse answer than not saying yet.
    expect(
      screen.getByRole("heading", { name: "1 voted" }),
    ).toBeInTheDocument();
  });
});
