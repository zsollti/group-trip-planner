import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AuthProvider,
  createQueryClient,
  setAccessToken,
} from "@gtp/api-client";
import { App } from "./App";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("web-deck auth flow", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  it("redirects an unauthenticated visitor to the sign-in screen", async () => {
    // Silent refresh on load fails -> unauthenticated.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({}, 401)),
    );

    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("signs in and lands on the command deck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith("/auth/refresh")) return json({}, 401);
        if (u.endsWith("/auth/login")) {
          return json({
            accessToken: "access-token",
            user: {
              id: "u1",
              email: "ada@example.com",
              displayName: "Ada",
              emailVerified: true,
            },
          });
        }
        if (u.includes("/dashboard"))
          return json({ trips: [], total: 0, limit: 20, offset: 0 });
        return json({ message: "not found" }, 404);
      }),
    );

    renderAt("/login");

    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // Landed on the authenticated Deck workspace with an empty trip manifest.
    expect(await screen.findByText(/welcome, ada/i)).toBeInTheDocument();
    expect(screen.getByText(/command deck/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /create your first trip/i }),
    ).toBeInTheDocument();
  });
});

describe("web-deck invite join (Phase 1.3)", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  const tripDetail = {
    id: "t1",
    name: "Lisbon 2026",
    description: null,
    destination: "Lisbon",
    coverImageUrl: null,
    defaultCurrency: "EUR",
    startDate: null,
    endDate: null,
    expiresAt: new Date().toISOString(),
    status: "ACTIVE",
    version: 0,
    role: "PARTICIPANT",
    memberCount: 2,
    createdAt: new Date().toISOString(),
  };

  it("a logged-out invite arrival signs in, then auto-joins and opens the trip", async () => {
    let joined = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        // Start logged out.
        if (u.endsWith("/auth/refresh")) return json({}, 401);
        if (u.endsWith("/auth/login")) {
          return json({
            accessToken: "access-token",
            user: {
              id: "u1",
              email: "ada@example.com",
              displayName: "Ada",
              emailVerified: true,
            },
          });
        }
        if (u.endsWith("/join/tok123") && init?.method === "POST") {
          joined = true;
          return json({ tripId: "t1", role: "PARTICIPANT", alreadyMember: false });
        }
        if (u.endsWith("/trips/t1")) return json(tripDetail);
        return json({ message: "not found" }, 404);
      }),
    );

    // Arrive on the invite link while logged out → bounced to sign in.
    renderAt("/join/tok123");
    expect(
      await screen.findByRole("heading", { name: /sign in/i }),
    ).toBeInTheDocument();

    // Sign in — the token rode the ?next= redirect, so we return to /join and redeem.
    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // Auto-joined and landed inside the trip.
    expect(await screen.findByText(/lisbon 2026/i)).toBeInTheDocument();
    expect(joined).toBe(true);
  });
});
