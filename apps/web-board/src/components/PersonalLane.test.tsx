import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { CategoryView, PersonalItemView } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { PersonalLane } from "./PersonalLane";
import { boardTourSteps } from "../lib/tour";

/**
 * The reader's own column.
 *
 * What is pinned here is what the column *promises*: that it says who can see
 * it, that it is reachable from an empty board, that reordering sends the whole
 * order rather than the gesture, and — the one worth a test of its own — that
 * two readers on the same board never share a cached list.
 *
 * Money is formatted in the reader's locale, so nothing asserts a literal
 * amount string; the assertions are on digits and on what the column does.
 */

const JSON_HEADERS = { "content-type": "application/json" };

function category(over: Partial<CategoryView> = {}): CategoryView {
  return {
    id: "cat-travel",
    name: "Transport",
    singleChoice: false,
    isBuiltin: true,
    builtinKey: "TRANSPORT",
    paletteKey: null,
    position: 0,
    version: 1,
    ...over,
  };
}

let seq = 0;
function item(over: Partial<PersonalItemView> = {}): PersonalItemView {
  seq += 1;
  return {
    id: `pi-${seq}`,
    tripId: "t1",
    categoryId: null,
    title: `Item ${seq}`,
    description: null,
    url: null,
    amount: null,
    currency: "EUR",
    startsAt: null,
    endsAt: null,
    position: seq - 1,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** Renders the column against a fetch mock, and hands back the mock. */
function renderLane(
  items: PersonalItemView[],
  {
    categories = [],
    myUserId = "me",
    frozen = false,
  }: {
    categories?: readonly CategoryView[];
    myUserId?: string | undefined;
    frozen?: boolean;
  } = {},
) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown = items;
    if (u.includes("/reorder")) {
      // The server answers a reorder with the whole list in its new order.
      const sent = JSON.parse(String(init?.body)) as { orderedIds: string[] };
      body = sent.orderedIds.map((id, position) => ({
        ...items.find((i) => i.id === id)!,
        position,
      }));
    } else if (method === "POST" || method === "PATCH") {
      body = item({ title: "Written" });
    } else if (method === "DELETE") {
      body = null;
    }
    return new Response(body === null ? null : JSON.stringify(body), {
      status: method === "DELETE" ? 204 : 200,
      headers: JSON_HEADERS,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <PersonalLane
        tripId="t1"
        myUserId={myUserId}
        categories={categories}
        defaultCurrency="EUR"
        frozen={frozen}
      />
    </QueryClientProvider>,
  );
  return { ...view, fetchMock };
}

describe("PersonalLane", () => {
  it("says who can see it, once, at the top", async () => {
    renderLane([item({ title: "Flight home" })]);

    expect(await screen.findByText("Personal")).toBeInTheDocument();
    // The claim is the column's, not each card's — so exactly one of these,
    // however many items are in it.
    expect(screen.getAllByText("Only you can see these")).toHaveLength(1);
  });

  it("carries the anchor its tour step points at", async () => {
    // The tour drops any step whose anchor is missing, silently and by design
    // — which means a renamed or deleted `data-tour` here does not break the
    // tour, it removes a step from it and says nothing. This is the seam.
    const { container } = renderLane([item({ title: "Flight home" })]);
    await screen.findByText("Personal");

    const anchor = boardTourSteps().find((s) => s.id === "personal")?.anchor;
    expect(anchor).toBe("personal");
    expect(container.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull();
  });

  it("offers a way in from an empty column", async () => {
    // The only place the feature announces itself. A column that appeared once
    // you already had an item would be findable only by people who already
    // knew about it.
    renderLane([]);
    expect(
      await screen.findByRole("button", {
        name: /Add something only you pay for/i,
      }),
    ).toBeInTheDocument();
  });

  it("goes read-only when the trip has ended", async () => {
    renderLane([item({ title: "Flight home" })], { frozen: true });

    expect(await screen.findByText("Flight home")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ Add card" }),
    ).not.toBeInTheDocument();
    // No "⋯" either: every action on it is a write.
    expect(
      screen.queryByRole("button", { name: /Actions for/i }),
    ).not.toBeInTheDocument();
  });

  it("sends the resulting order, not the move", async () => {
    const a = item({ title: "First" });
    const b = item({ title: "Second" });
    const { fetchMock } = renderLane([a, b]);

    fireEvent.click(await screen.findByRole("button", { name: /First/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Move down/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/reorder"),
      );
      expect(call).toBeDefined();
      // The endpoint takes the complete list — which is what makes the write
      // idempotent and gap-free — so the client computes the result and states
      // it, rather than describing the swap it made.
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        orderedIds: [b.id, a.id],
      });
    });
  });

  it("offers no move off the end of the list", async () => {
    const a = item({ title: "First" });
    const b = item({ title: "Second" });
    renderLane([a, b]);

    fireEvent.click(await screen.findByRole("button", { name: /First/i }));
    expect(
      screen.queryByRole("button", { name: /Move up/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Move down/ }),
    ).toBeInTheDocument();
  });

  it("marks a tagged item with its lane's name, and leaves an untagged one bare", async () => {
    const cat = category();
    renderLane(
      [
        item({ title: "Flight", categoryId: cat.id }),
        item({ title: "Insurance", categoryId: null }),
      ],
      { categories: [cat] },
    );

    expect(
      await screen.findByLabelText("Tagged Transport"),
    ).toBeInTheDocument();
    // The tag is only a colour, so an untagged item gets no placeholder mark
    // standing in for one — there is exactly the one.
    expect(screen.getAllByLabelText(/^Tagged /)).toHaveLength(1);
  });

  it("keeps one reader's cached list away from the next", async () => {
    // Signing out clears the session and deliberately not the query cache, so
    // on a shared browser the second person renders against whatever the first
    // one left behind. The viewer is in the query key precisely so there is
    // nothing there to render.
    const client = createQueryClient();
    const mine = [item({ title: "My flight" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(mine), {
            status: 200,
            headers: JSON_HEADERS,
          }),
      ),
    );

    const shared = (myUserId: string) => (
      <QueryClientProvider client={client}>
        <PersonalLane
          tripId="t1"
          myUserId={myUserId}
          categories={[]}
          defaultCurrency="EUR"
        />
      </QueryClientProvider>
    );

    const first = render(shared("ada"));
    expect(await screen.findByText("My flight")).toBeInTheDocument();
    first.unmount();

    // Same QueryClient, same trip, different person: their key has never been
    // fetched, so the column starts empty rather than showing Ada's list.
    render(shared("bob"));
    expect(screen.queryByText("My flight")).not.toBeInTheDocument();
  });
});
