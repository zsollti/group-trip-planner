import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("web-board auth flow", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  it("redirects an unauthenticated visitor to the sign-in card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({}, 401)),
    );

    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("signs in and lands on the boards canvas", async () => {
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
        if (u.includes("/notifications"))
          return json({ notifications: [], unreadCount: 0, nextCursor: null });
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

    // Landed on the boards overview with an empty-state CTA.
    expect(await screen.findByText(/welcome, ada/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /create your first trip/i }),
    ).toBeInTheDocument();
  });

  it("shows the unread badge and opens the notification bell (Phase 5.1)", async () => {
    setAccessToken("access-token");
    const markAll = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/auth/refresh")) {
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
        if (u.includes("/notifications/read-all")) {
          markAll(init?.method);
          return json({ unreadCount: 0 });
        }
        if (u.includes("/notifications")) {
          return json({
            notifications: [
              {
                id: "n1",
                type: "OPTION_LOCKED",
                tripId: "t1",
                tripName: "Alps",
                actorName: "Grace",
                subject: "Night train",
                categoryId: null,
                channelId: null,
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            unreadCount: 1,
            nextCursor: null,
          });
        }
        if (u.includes("/dashboard"))
          return json({ trips: [], total: 0, limit: 20, offset: 0 });
        return json({ message: "not found" }, 404);
      }),
    );

    renderAt("/");

    // The badge count rides on the trigger's accessible name.
    const bell = await screen.findByRole("button", {
      name: /notifications, 1 unread/i,
    });
    fireEvent.click(bell);

    expect(
      await screen.findByText(/grace locked in “night train”/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    // The mutation fires its request off-tick, so wait for it rather than
    // asserting in the same tick as the click.
    await waitFor(() => {
      expect(markAll).toHaveBeenCalledWith("POST");
    });
  });
});
