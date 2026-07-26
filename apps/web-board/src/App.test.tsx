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

  it("toggles the mention-email preference from settings (Phase 5.3)", async () => {
    setAccessToken("access-token");
    const patched: unknown[] = [];
    let emailOnMention = true;
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
        if (u.includes("/account/preferences")) {
          if (init?.method === "PATCH") {
            const body = JSON.parse(String(init.body)) as {
              emailOnMention: boolean;
            };
            patched.push(body);
            emailOnMention = body.emailOnMention;
          }
          return json({ emailOnMention });
        }
        if (u.includes("/notifications"))
          return json({ notifications: [], unreadCount: 0, nextCursor: null });
        return json({ message: "not found" }, 404);
      }),
    );

    renderAt("/settings");

    // The switch reports its state through ARIA, not through its styling.
    const toggle = await screen.findByRole("switch", {
      name: /email me when i'm @mentioned/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(patched).toEqual([{ emailOnMention: false }]);
    });
    // The server's answer is what the control settles on.
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: /email me when i'm @mentioned/i }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });

  it("shows the unsubscribe landing to a logged-out visitor (Phase 5.3)", async () => {
    // No session at all: the link is opened from a mail client.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({}, 401)),
    );

    renderAt("/unsubscribed?status=ok");

    expect(
      await screen.findByRole("heading", { name: /you're unsubscribed/i }),
    ).toBeInTheDocument();
    // It must not bounce to the sign-in card the way a guarded route would.
    expect(
      screen.queryByRole("heading", { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });
});
