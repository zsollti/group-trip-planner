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

    // Landed on the authenticated Deck workspace.
    expect(await screen.findByText(/welcome, ada/i)).toBeInTheDocument();
    expect(screen.getByText(/command deck/i)).toBeInTheDocument();
  });
});
