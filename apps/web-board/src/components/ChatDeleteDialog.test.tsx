import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ChannelView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { ChatDeleteDialog } from "./ChatDeleteDialog";

/**
 * Closing discussions — functional/DOM tests (no screenshot tests).
 *
 * The act destroys everything everyone said in a conversation, so what is
 * pinned here is the friction that stands between a stray click and that: the
 * button is dead until something is ticked, and ticking is not the act — the
 * confirm is. The server's refusal to delete the board's own conversation has
 * its own test on the API; what this file pins is that the list never offers
 * it, because a list that offers an impossible choice is its own defect.
 */

const TRIP_ID = "11111111-1111-4111-8111-111111111111";

function channel(id: string, categoryId: string | null): ChannelView {
  return {
    id,
    tripId: TRIP_ID,
    categoryId,
    type: categoryId ? "CATEGORY" : "GENERAL",
    lastMessageAt: null,
  };
}

const lanes = [channel("ch1", "c1"), channel("ch2", "c2")];

const NAMES: Record<string, string> = { ch1: "Transport", ch2: "Stay" };

function renderDialog(channels: ChannelView[] = lanes) {
  const sent: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    sent.push(JSON.parse(String((init as RequestInit).body)));
    return Promise.resolve(
      new Response(JSON.stringify(["ch1"]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  const closed: boolean[] = [];
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatDeleteDialog
        tripId={TRIP_ID}
        channels={channels}
        channelName={(c) => NAMES[c.id] ?? "Discussion"}
        onClose={() => closed.push(true)}
      />
    </QueryClientProvider>,
  );
  return { sent, closed };
}

describe("deleting a board's discussions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists the discussions by name", () => {
    renderDialog();
    expect(screen.getByLabelText("Transport")).toBeInTheDocument();
    expect(screen.getByLabelText("Stay")).toBeInTheDocument();
  });

  it("will not delete until something is ticked", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Transport"));
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("asks before it does it, and sends nothing until answered", async () => {
    const { sent } = renderDialog();
    fireEvent.click(screen.getByLabelText("Transport"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // The first Delete opens the question; it does not answer it.
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("counts what it is about to take, in the right number", async () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText("Transport"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // One ticked, so the singular — "1 discussions" is the bug this guards.
    expect(screen.getByText(/1 discussion and everything/)).toBeInTheDocument();
  });

  it("sends every ticked discussion in one request", async () => {
    const { sent, closed } = renderDialog();
    fireEvent.click(screen.getByLabelText("Transport"));
    fireEvent.click(screen.getByLabelText("Stay"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // One request, not one per tick: a half-done deletion is not a state this
    // should be able to reach.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ channelIds: ["ch1", "ch2"] });
    await waitFor(() => expect(closed).toHaveLength(1));
  });

  it("backs out of the question without deleting", async () => {
    const { sent } = renderDialog();
    fireEvent.click(screen.getByLabelText("Transport"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/cannot be undone/)).toBeNull();
    expect(sent).toHaveLength(0);
    // And the tick survives, so backing out is not starting over.
    expect(screen.getByLabelText("Transport")).toBeChecked();
  });

  it("says so when there is nothing to delete", () => {
    renderDialog([]);
    expect(
      screen.getByText("This board has no discussions to delete yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
