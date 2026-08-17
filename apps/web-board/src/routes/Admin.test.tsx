import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { Admin } from "./Admin";

/**
 * The operator's console.
 *
 * The panels that merely list numbers are not what these cover — a count that
 * renders wrong is obvious the first time anyone looks. What is covered is the
 * console's actual job: **saying that something is broken when it is**, in the
 * two cases the rest of the system reports as healthy.
 *
 * A worker that dies mid-send leaves jobs claimed `SENDING` forever, and a
 * stale exchange-rate snapshot keeps every `≈` total quietly wrong. Both look
 * completely normal from `/health`, which only asks Postgres whether it is
 * alive. If these warnings fail to appear, the console is worse than useless —
 * it is a green light over a broken deployment.
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({ user: { email: "ops@example.com" }, logout: vi.fn() }),
  };
});

const JSON_HEADERS = { "content-type": "application/json" };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const HEALTHY = {
  system: {
    contractVersion: "0.44.0",
    commit: "abcdef1234567890",
    startedAt: new Date().toISOString(),
    nodeVersion: "v22.0.0",
    environment: "production",
  },
  volume: {
    users: 12,
    verifiedUsers: 9,
    trips: 4,
    activeTrips: 3,
    options: 40,
    messages: 88,
    uploadBytes: 2_400_000,
    signups: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      count: i % 3,
    })),
  },
  email: {
    pending: 0,
    sending: 0,
    sent: 31,
    failed: 0,
    stuckSending: 0,
    configured: true,
    recentFailures: [],
  },
  rates: {
    configured: true,
    currencies: 31,
    asOf: "2026-08-15",
    fetchedAt: new Date().toISOString(),
    source: "ecb",
  },
};

function mockApi(overview: unknown, extra?: (path: string) => Response | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const custom = extra?.(path);
      if (custom) return custom;
      if (path.startsWith("/admin/overview")) return json(overview);
      if (path.startsWith("/admin/audit")) return json({ entries: [] });
      if (path.startsWith("/admin/users") && init?.method === "POST") {
        return json({ ...USER, emailVerified: true });
      }
      if (path.startsWith("/admin/users")) return json({ users: [USER] });
      return json({ message: "not found" }, 404);
    }),
  );
}

const USER = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "stuck@example.com",
  displayName: "Stuck Person",
  emailVerified: false,
  createdAt: new Date().toISOString(),
  anonymizedAt: null,
  hasPassword: true,
  tripCount: 2,
  lastSeenAt: null,
  emailJobs: [],
};

function renderConsole() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <Admin />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the console reports a healthy deployment plainly", () => {
  beforeEach(() => mockApi(HEALTHY));

  it("names the build that is actually serving", async () => {
    renderConsole();
    // The API had no equivalent of the web app's build.txt, so "did my deploy
    // land" was unanswerable from this side.
    expect(await screen.findByText("abcdef1234")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  it("raises no alarm when nothing is wrong", async () => {
    renderConsole();
    await screen.findByText("abcdef1234");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the console reports what nothing else would", () => {
  it("says so when mail jobs are stuck mid-send", async () => {
    mockApi({
      ...HEALTHY,
      email: { ...HEALTHY.email, sending: 3, stuckSending: 3 },
    });
    renderConsole();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/worker probably died mid-send/i);
  });

  it("shows the provider's own reason for a failed send", async () => {
    mockApi({
      ...HEALTHY,
      email: {
        ...HEALTHY.email,
        failed: 1,
        recentFailures: [
          {
            id: "e1",
            to: "nope@example.com",
            type: "MENTION",
            attempts: 3,
            lastError: "550 recipient rejected",
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    });
    renderConsole();

    // The whole point of surfacing the queue: "they never got the email" is
    // answerable without opening a psql prompt.
    expect(await screen.findByText("nope@example.com")).toBeInTheDocument();
    expect(screen.getByText("550 recipient rejected")).toBeInTheDocument();
  });

  it("says so when a configured rate feed has gone stale", async () => {
    const old = new Date(Date.now() - 9 * 24 * 3600_000).toISOString();
    mockApi({
      ...HEALTHY,
      rates: { ...HEALTHY.rates, fetchedAt: old },
    });
    renderConsole();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/has not refreshed in days/i);
  });

  it("does not cry stale when conversion is simply switched off", async () => {
    // No feed configured is a valid deployment — every dashboard just reports
    // exact per-currency figures. Warning about it would train the operator to
    // ignore the panel that matters.
    mockApi({
      ...HEALTHY,
      rates: {
        configured: false,
        currencies: 0,
        asOf: null,
        fetchedAt: null,
        source: null,
      },
    });
    renderConsole();

    await screen.findByText("abcdef1234");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/conversion is off/i)).toBeInTheDocument();
  });
});

describe("finding one person", () => {
  beforeEach(() => mockApi(HEALTHY));

  it("shows their verification state and offers the two ways out", async () => {
    renderConsole();
    await screen.findByText("abcdef1234");

    fireEvent.change(screen.getByLabelText(/email, name, or user id/i), {
      target: { value: "stuck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("stuck@example.com")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend verification/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark verified/i }),
    ).toBeInTheDocument();
  });

  it("confirms an action rather than leaving the operator guessing", async () => {
    renderConsole();
    await screen.findByText("abcdef1234");
    fireEvent.change(screen.getByLabelText(/email, name, or user id/i), {
      target: { value: "stuck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /resend verification/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /verification email sent/i,
      ),
    );
  });
});

describe("a non-operator who reaches the page anyway", () => {
  it("is told the console is not there, in the same words the API used", async () => {
    // The route is only "signed in"-guarded client-side; the real gate is the
    // API answering 404 to anyone this deployment has not named. Reaching the
    // URL directly must therefore be a dead end, not a broken-looking screen.
    mockApi(HEALTHY, (path) =>
      path.startsWith("/admin/overview")
        ? json({ message: "Cannot GET /admin/overview" }, 404)
        : null,
    );
    renderConsole();

    // Generous, because the shared QueryClient retries once before it settles
    // on the error — the default 1s wait races that retry's backoff.
    expect(
      await screen.findByText(/no console configured for you/i, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
  });
});

describe("rebuilding the demo trip", () => {
  const SUMMARY = {
    tripId: "33333333-3333-4333-8333-333333333333",
    tripName: "Lisbon — long weekend",
    email: "demo@example.com",
    members: 5,
    options: 14,
    decisions: 4,
    messages: 14,
    removedTrips: 1,
  };

  function mockWithSeed() {
    mockApi(HEALTHY, (path) =>
      path.startsWith("/admin/demo-seed") ? json(SUMMARY, 201) : null,
    );
  }

  /** Every POST the console has made, which for this panel should be none. */
  function posts(): string[] {
    const fetchMock = globalThis.fetch as unknown as {
      mock: { calls: [string | URL, RequestInit?][] };
    };
    return fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url]) => String(url));
  }

  it("asks before it destroys anything", async () => {
    // The only destructive button in the app. One click must not be enough —
    // and "not enough" has to mean no request was sent, not merely that the UI
    // looked hesitant afterwards.
    mockWithSeed();
    renderConsole();
    await screen.findByText("abcdef1234");

    fireEvent.click(
      screen.getByRole("button", { name: /rebuild the demo trip/i }),
    );
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
    expect(posts()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/cannot be undone/i)).toBeNull();
    expect(posts()).toEqual([]);
  });

  it("reports what it replaced, not just that it worked", async () => {
    // "Done" would leave the operator wondering whether it had run against the
    // database they meant. The counts and the swept-trip figure are how a
    // rebuild of the real demo is told from a first build on an empty database.
    mockWithSeed();
    renderConsole();
    await screen.findByText("abcdef1234");

    fireEvent.click(
      screen.getByRole("button", { name: /rebuild the demo trip/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /yes, rebuild it/i }));

    expect(await screen.findByText(/demo rebuilt/i)).toBeInTheDocument();
    expect(
      screen.getByText(/5 members · 14 options · 4 decisions · 14 messages/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 previous demo trip/)).toBeInTheDocument();
    expect(posts()).toEqual([
      expect.stringContaining("/admin/demo-seed"),
    ] as unknown as string[]);
  });
});
