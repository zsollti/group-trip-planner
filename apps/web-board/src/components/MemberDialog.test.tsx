import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@gtp/api-client";
import type { TripMembersView, TripRole } from "@gtp/types";
import { MemberDialog } from "./MemberDialog";

/**
 * The crew dialog had no test at all, which is how it grew four controls per
 * row — a role `<select>`, Kick, Block and Make owner — without anyone having to
 * say what the row was *for*. This pins the shape it collapsed into: one "⋯" per
 * member, holding the role changes it isn't and the destructive three.
 *
 * What is asserted is the request that leaves, not the state that changed: the
 * list is a server query, so a role change is only real if it PATCHes.
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return { ...actual, useAuth: () => ({ user: { id: "u-me" } }) };
});

const members: TripMembersView = {
  members: [
    {
      userId: "u-me",
      displayName: "Ada Lovelace",
      avatarUrl: null,
      role: "OWNER",
      joinedAt: "2026-01-01T00:00:00.000Z",
      isOwner: true,
    },
    {
      userId: "u-grace",
      displayName: "Grace Hopper",
      avatarUrl: null,
      role: "PARTICIPANT",
      joinedAt: "2026-01-02T00:00:00.000Z",
      isOwner: false,
    },
  ],
  blocked: [],
};

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/members") && method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify(members), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

function renderDialog(myRole: TripRole = "OWNER") {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <MemberDialog tripId="t1" myRole={myRole} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The "⋯" for a named member, once the roster has arrived. */
async function openMenuFor(name: string) {
  const trigger = await screen.findByRole("button", {
    name: `Actions for ${name}`,
  });
  fireEvent.click(trigger);
  return trigger;
}

describe("MemberDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("gives each member one menu instead of a row of controls", async () => {
    mockFetch();
    renderDialog();

    await openMenuFor("Grace Hopper");

    // The roles she is not — hers is written beside her name, so offering it
    // again would be an item that does nothing.
    expect(
      screen.getByRole("button", { name: "Make co-organizer" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Make guest" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Make participant" }),
    ).toBeNull();
    // And the four controls that used to be on the row are gone from it.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("changes a role from the menu", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    await openMenuFor("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Make co-organizer" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(String(patch?.[0])).toContain("/trips/t1/members/u-grace");
      expect(String((patch?.[1] as RequestInit).body)).toContain(
        "CO_ORGANIZER",
      );
    });
  });

  it("keeps removal behind the menu and a confirmation", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    await openMenuFor("Grace Hopper");
    fireEvent.click(screen.getByRole("button", { name: "Remove from trip" }));

    // Nothing has left yet — the menu item asks, it does not act.
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);
    expect(screen.getByText(/Remove Grace Hopper\?/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(String(del?.[0])).toContain("/trips/t1/members/u-grace");
    });
  });

  it("offers no menu on yourself", async () => {
    mockFetch();
    renderDialog();

    // Waiting on the other row's trigger is what proves the roster rendered —
    // asserting an absence before the fetch resolves would pass for the wrong
    // reason.
    await screen.findByRole("button", { name: "Actions for Grace Hopper" });
    expect(
      screen.queryByRole("button", { name: "Actions for Ada Lovelace" }),
    ).toBeNull();
  });

  it("closes with the dialog's own ✕ and nothing else", async () => {
    mockFetch();
    renderDialog("PARTICIPANT");

    await screen.findByText("Grace Hopper");
    // One way out, not two.
    //
    // Queried off the document rather than off the render's `container`: the
    // dialog is portalled into `document.body`, so it is not a descendant of
    // the tree it was written in. That is the whole point of the portal — see
    // `Dialog` — and a test that reached through `container` would be asserting
    // on the layout the modal deliberately escaped.
    const dialog = within(document.querySelector("[role=dialog]")!);
    expect(dialog.queryByRole("button", { name: "Close" })).not.toBeNull();
    expect(dialog.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("does not offer leaving — that is an action on the trip, not on the crew", async () => {
    mockFetch();
    renderDialog("PARTICIPANT");

    // A member is exactly the role that *can* leave, so its absence here has to
    // be asserted against a rendered roster rather than against a pending one:
    // waiting for a name first is what makes this a statement about the finished
    // dialog. Leaving now lives in the trip's own "⋯" (see `TripDetail`).
    await screen.findByText("Grace Hopper");
    expect(screen.queryByRole("button", { name: "Leave trip" })).toBeNull();
  });
});
