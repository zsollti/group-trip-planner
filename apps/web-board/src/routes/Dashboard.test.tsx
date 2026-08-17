import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@gtp/api-client";
import type { HomeTripSummary } from "@gtp/types";
import { Dashboard } from "./Dashboard";

/**
 * The overview's arrangement.
 *
 * The drag itself belongs to dnd-kit and is driven by pointer geometry, which
 * jsdom does not do — so what is pinned here is everything around it that *is*
 * assertable and that a refactor can silently break: that every active tile
 * carries a way to grab it, that the grip is a real focusable control rather
 * than a hover-only affordance, that it is a **button beside** the link instead
 * of inside it, and that an ended trip does not get one. The last is the rule
 * the feature is built on — History is what a trip becomes, not somewhere you
 * put it — and it is the one most likely to be lost in a tidy-up.
 */

const trip = (over: Partial<HomeTripSummary> = {}): HomeTripSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Lisbon",
  destination: null,
  startDate: null,
  endDate: null,
  status: "ACTIVE",
  role: "OWNER",
  memberCount: 2,
  defaultCurrency: "EUR",
  cost: [],
  pendingDecisionCount: 0,
  createdAt: new Date().toISOString(),
  ...over,
});

const trips: HomeTripSummary[] = [
  trip({ id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Lisbon" }),
  trip({ id: "bbbbbbbb-2222-4222-8222-222222222222", name: "Alps" }),
  trip({
    id: "cccccccc-3333-4333-8333-333333333333",
    name: "Last year",
    status: "HISTORY",
  }),
];

const reorderCalls: (readonly string[])[] = [];

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({
      user: { id: "u1", displayName: "Ada", emailVerified: true },
    }),
    useNotifications: () => ({ data: { notifications: [], unreadCount: 0 } }),
    useHomeDashboard: () => ({
      isPending: false,
      isError: false,
      data: { trips, total: trips.length, limit: 20, offset: 0 },
    }),
    useReorderTrips: () => ({
      mutate: (ids: readonly string[]) => reorderCalls.push(ids),
    }),
  };
});

function renderDashboard() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard ordering", () => {
  it("gives every active tile a grip, and none to an ended one", () => {
    renderDashboard();
    expect(
      screen.getByRole("button", { name: "Reorder Lisbon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Alps" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reorder Last year" }),
    ).toBeNull();
  });

  it("keeps the grip outside the link it sits on", () => {
    // A link that is also its own drag handle either swallows the click that
    // opens it or opens a trip every time someone tries to move one.
    renderDashboard();
    const grip = screen.getByRole("button", { name: "Reorder Lisbon" });
    expect(grip.closest("a")).toBeNull();
    const tile = screen.getByRole("link", { name: /Lisbon/ });
    expect(tile.contains(grip)).toBe(false);
  });

  it("still opens the board it belongs to", () => {
    renderDashboard();
    expect(screen.getByRole("link", { name: /Lisbon/ })).toHaveAttribute(
      "href",
      "/trips/aaaaaaaa-1111-4111-8111-111111111111",
    );
  });
});
