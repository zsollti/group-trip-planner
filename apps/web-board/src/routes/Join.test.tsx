import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { Join } from "./Join";

/**
 * The invite landing, for somebody who is not signed in.
 *
 * The behaviour worth pinning is the one that changed: this page used to
 * redirect to the login form, so a visitor could not see what they had been
 * invited to without making an account for it. What it must now do is show the
 * trip — and, just as importantly, show **only** the trip: no way to vote, no
 * way to comment, nothing that would need a session behind it.
 */

const AUTH = { status: "unauthenticated" as string };

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return { ...actual, useAuth: () => AUTH };
});

const JSON_HEADERS = { "content-type": "application/json" };

const PREVIEW = {
  tripId: "11111111-1111-4111-8111-111111111111",
  name: "Lisbon in May",
  description: "Five days, one apartment, too much pastel de nata.",
  destination: "Lisbon",
  startDate: "2026-05-04T00:00:00.000Z",
  endDate: "2026-05-09T00:00:00.000Z",
  defaultCurrency: "EUR",
  acceptingMembers: true,
  memberCount: 2,
  members: [
    { userId: "u1", displayName: "Ada", avatarUrl: null },
    { userId: "u2", displayName: "Bo", avatarUrl: null },
  ],
  lanes: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Stay",
      builtinKey: "ACCOMMODATION",
      paletteKey: null,
      position: 0,
      options: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          // Short enough to survive `truncateName`, which the card applies just
          // as the board's own does.
          title: "Alfama flat",
          description: "Two bedrooms, a roof terrace.",
          url: "https://example.com/alfama",
          amount: 120,
          currency: "EUR",
          costType: "PER_PERSON",
          startsAt: null,
          endsAt: null,
          locked: true,
          voteCount: 3,
        },
      ],
    },
  ],
};

function mockPreview(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }),
    ),
  );
}

function mount() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={["/join/tok123"]}>
        <Routes>
          <Route path="/join/:token" element={<Join />} />
          <Route path="/login" element={<p>the login form</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("an invite link, opened without signing in", () => {
  it("shows the trip instead of a login form", async () => {
    mockPreview(PREVIEW);
    mount();

    expect(await screen.findByText("Lisbon in May")).toBeInTheDocument();
    // The board itself, not a summary of it: the lane, the proposal in it, and
    // what it costs are the answer to "what have I been invited to".
    expect(screen.getByText("Stay")).toBeInTheDocument();
    expect(screen.getByText("Alfama flat")).toBeInTheDocument();
    expect(screen.getByText("3 votes")).toBeInTheDocument();
    // And who is going, which the lanes cannot say.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("the login form")).toBeNull();
  });

  it("offers no way to touch anything", async () => {
    mockPreview(PREVIEW);
    const { container } = mount();
    await screen.findByText("Alfama flat");

    // Every control on this page leads to signing in. A vote button, a menu or
    // an input reaching this render would be a control offered to a stranger.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    for (const button of container.querySelectorAll("button")) {
      expect(button.textContent).toMatch(/sign in to join/i);
    }
  });

  it("sends the token on to the login form, so the link still redeems", async () => {
    mockPreview(PREVIEW);
    mount();

    // Twice on the page by design: once above the board and once below it, so
    // a reader who has just scrolled a trip's worth of lanes can act where they
    // are. Both are the same door.
    const links = await screen.findAllByRole("link", {
      name: /create an account/i,
    });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/login?next=/join/tok123");
    }
  });

  it("says a frozen trip is not taking anyone, rather than offering to join", async () => {
    mockPreview({ ...PREVIEW, acceptingMembers: false });
    mount();

    expect(
      await screen.findAllByText(/no longer taking new members/i),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /sign in to join/i }),
    ).toBeNull();
  });

  it("says what is wrong with a dead link in the server's own words", async () => {
    // Disabled, already used and invalid are different things to be told, and
    // a page that flattened them would leave somebody re-clicking a link that
    // will never work again.
    mockPreview({ message: "This invite link has been disabled." }, 410);
    mount();

    expect(
      await screen.findByText("This invite link has been disabled."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Lisbon in May")).toBeNull();
  });
});
