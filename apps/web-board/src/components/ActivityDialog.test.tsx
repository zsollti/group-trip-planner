import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent, ActivityPage } from "@gtp/types";
import { createQueryClient, setAccessToken } from "@gtp/api-client";
import { ActivityDialog } from "./ActivityDialog";

/**
 * Activity feed dialog (Phase 5.4) — functional/DOM only (no screenshot tests).
 * Asserts the three things the feed exists to do: render each kind of event as a
 * readable line, walk backwards through older pages, and say so plainly when
 * there is nothing to show.
 */

const JSON_HEADERS = { "content-type": "application/json" };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function event(over: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "e?",
    action: "OPTION_LOCKED",
    actorName: "Ada",
    targetName: null,
    subject: "Night train",
    fromRole: null,
    toRole: null,
    superseded: false,
    createdAt: "2026-07-26T10:00:00.000Z",
    ...over,
  };
}

function renderDialog() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ActivityDialog tripId="t1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("ActivityDialog", () => {
  beforeEach(() => {
    setAccessToken("access-token");
    vi.restoreAllMocks();
  });

  it("renders each kind of event as a readable line", async () => {
    const page: ActivityPage = {
      events: [
        event({ id: "e1" }),
        event({
          id: "e2",
          action: "MEMBER_ROLE_CHANGED",
          subject: null,
          targetName: "Grace",
          fromRole: "GUEST",
          toRole: "PARTICIPANT",
        }),
        event({
          id: "e3",
          action: "MEMBER_LEFT",
          subject: null,
          actorName: "Bob",
          targetName: "Bob",
        }),
      ],
      nextCursor: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(page)),
    );

    renderDialog();

    expect(
      await screen.findByText(/ada locked in “night train”/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ada changed grace from guest to participant/i),
    ).toBeInTheDocument();
    // The leaver is named as the actor, not "removed by" anyone.
    expect(screen.getByText(/bob left the trip/i)).toBeInTheDocument();
  });

  it("loads an older page on request", async () => {
    const first: ActivityPage = {
      events: [event({ id: "e1", subject: "Night train" })],
      nextCursor: "e1",
    };
    const older: ActivityPage = {
      events: [event({ id: "e0", subject: "Ferry" })],
      nextCursor: null,
    };
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        seen.push(u);
        return json(u.includes("cursor=e1") ? older : first);
      }),
    );

    renderDialog();

    expect(
      await screen.findByText(/ada locked in “night train”/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /load older/i }));

    // Older events append below the newer ones rather than replacing them.
    expect(
      await screen.findByText(/ada locked in “ferry”/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ada locked in “night train”/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(seen.some((u) => u.includes("cursor=e1"))).toBe(true);
    });
  });

  it("says so plainly when nothing has happened yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ events: [], nextCursor: null })),
    );

    renderDialog();

    expect(
      await screen.findByText(/nothing has happened here yet/i),
    ).toBeInTheDocument();
  });

  it("offers a retry when the feed fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "boom" }, 500)),
    );

    renderDialog();

    // The shared query client retries once with backoff, so the error state
    // lands later than findBy's default 1s — wait for the real behaviour rather
    // than turning retries off just for the test.
    expect(
      await screen.findByText(
        /couldn't load this board's activity/i,
        undefined,
        {
          timeout: 4000,
        },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});
