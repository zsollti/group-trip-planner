import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AuthProvider,
  createQueryClient,
  setAccessToken,
} from "@gtp/api-client";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Mount the dialog with a /login destination so we can observe the redirect. */
function renderDialog() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route
              path="/"
              element={<DeleteAccountDialog onClose={() => {}} />}
            />
            <Route path="/login" element={<h1>Signed out</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("web-deck DeleteAccountDialog (Phase 1.5)", () => {
  beforeEach(() => {
    setAccessToken(null);
    vi.restoreAllMocks();
  });

  it("shows the deletion impact, then deletes and redirects to sign-in", async () => {
    let deleteBody: unknown = null;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/refresh")) return json({}, 401);
      if (u.endsWith("/account/deletion-preview")) {
        return json({
          transfers: [
            {
              tripId: "11111111-1111-1111-1111-111111111111",
              tripName: "Lisbon 2026",
              successorUserId: "22222222-2222-2222-2222-222222222222",
              successorDisplayName: "Grace",
            },
          ],
          deletions: [
            {
              tripId: "33333333-3333-3333-3333-333333333333",
              tripName: "Solo Retreat",
            },
          ],
        });
      }
      if (u.endsWith("/account") && init?.method === "DELETE") {
        deleteBody = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      return json({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();

    // The impact warning names both the transfer target and the doomed trip.
    expect(await screen.findByText("Lisbon 2026")).toBeInTheDocument();
    expect(screen.getByText(/Grace/)).toBeInTheDocument();
    expect(screen.getByText("Solo Retreat")).toBeInTheDocument();

    // Confirm the deletion.
    fireEvent.click(
      screen.getByRole("button", { name: /delete my account/i }),
    );

    // Redirected to sign-in, and the DELETE carried the explicit confirmation.
    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();
    expect(deleteBody).toEqual({ confirm: true });
  });

  it("surfaces an error and keeps the session if deletion fails", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/auth/refresh")) return json({}, 401);
      if (u.endsWith("/account/deletion-preview")) {
        return json({ transfers: [], deletions: [] });
      }
      if (u.endsWith("/account") && init?.method === "DELETE") {
        return json({ message: "Something went wrong" }, 500);
      }
      return json({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();

    // No owned trips → the "nothing owned" copy renders.
    expect(await screen.findByText(/don't own any trips/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /delete my account/i }),
    );

    // The error is shown and we're NOT redirected.
    expect(
      await screen.findByText(/something went wrong/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/signed out/i)).not.toBeInTheDocument();
  });
});
