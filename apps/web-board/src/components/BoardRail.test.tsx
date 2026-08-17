import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { TripRole } from "@gtp/types";
import { createQueryClient } from "@gtp/api-client";
import { BoardRail } from "./BoardRail";

/**
 * The rail beside the working surface — what the trip costs, and who is on it.
 *
 * These cases were written against `BoardCanvas`, which used to render the rail
 * itself. They moved with it: the rail now stands beside *either* view of the
 * trip, so testing "does the crew panel offer Manage?" through the lane canvas
 * would be asserting a fact about the crew by mounting a drag context and a row
 * of categories that have nothing to do with it.
 */

const JSON_HEADERS = { "content-type": "application/json" };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

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
          lines: [],
          memberCount: 2,
        });
      }
      if (u.includes("/members")) return json(MEMBERS);
      return json({ message: "not found" }, 404);
    }),
  );
}

const onManageMembers = vi.fn();
const onInviteMembers = vi.fn();

function renderRail(myRole: TripRole) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BoardRail
        tripId="t1"
        myRole={myRole}
        myUserId="u1"
        onManageMembers={onManageMembers}
        onInviteMembers={onInviteMembers}
      />
    </QueryClientProvider>,
  );
}

describe("BoardRail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    onManageMembers.mockClear();
    onInviteMembers.mockClear();
    // The cost strip's chart form persists per browser; clear it so one test's
    // choice cannot decide what the next one renders.
    window.localStorage.clear();
  });

  it("names the crew and their roles in the summary band", async () => {
    // What the band is for now: the lanes below can be read for what the trip
    // has decided, but not for who is deciding it.
    mockFetch();
    renderRail("OWNER");

    const crew = await screen.findByRole("region", { name: "Crew" });
    // The panel renders straight away with its loading state, so the region
    // being present says nothing — wait for the roster itself.
    expect(await within(crew).findByText(/Ada/)).toBeInTheDocument();
    expect(within(crew).getByText("Grace")).toBeInTheDocument();
    expect(within(crew).getByText("Participant")).toBeInTheDocument();
  });

  it("sends an organizer from the crew panel to the members dialog", async () => {
    // The panel is read-only by design — roles, kicks and blocks are
    // consequential and stay behind a deliberate click.
    mockFetch();
    renderRail("OWNER");

    const crew = await screen.findByRole("region", { name: "Crew" });
    fireEvent.click(within(crew).getByRole("button", { name: "Manage" }));

    expect(onManageMembers).toHaveBeenCalledTimes(1);
  });

  it("offers a participant a way to see the crew, not to change it", async () => {
    mockFetch();
    renderRail("PARTICIPANT");

    const crew = await screen.findByRole("region", { name: "Crew" });
    expect(within(crew).getByRole("button", { name: "View" })).toBeVisible();
    expect(within(crew).queryByRole("button", { name: "Manage" })).toBeNull();
  });

  it("invites from the crew panel rather than the trip header", async () => {
    // Inviting is something you do to the crew, so it lives with the list of
    // who is already on it — the header had it a screen away.
    mockFetch();
    renderRail("OWNER");

    const crew = await screen.findByRole("region", { name: "Crew" });
    fireEvent.click(within(crew).getByRole("button", { name: "Invite" }));

    expect(onInviteMembers).toHaveBeenCalledTimes(1);
  });

  it("gives a guest no way to invite", async () => {
    // A Guest can read the crew but not grow it. The button moved; the gate
    // that used to hide it in the header came with it.
    mockFetch();
    renderRail("GUEST");

    const crew = await screen.findByRole("region", { name: "Crew" });
    expect(within(crew).queryByRole("button", { name: "Invite" })).toBeNull();
  });
});
