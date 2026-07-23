import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, setAccessToken } from "@gtp/api-client";
import { CategoryManager } from "./CategoryManager";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const cat = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "c1",
  name: "Dates",
  singleChoice: true,
  isBuiltin: true,
  builtinKey: "DATES",
  position: 0,
  version: 0,
  ...over,
});

function renderManager() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CategoryManager tripId="t1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("web-deck CategoryManager (Phase 2.1)", () => {
  beforeEach(() => {
    setAccessToken("access-token");
    vi.restoreAllMocks();
  });

  it("lists the categories and creates a new one via the API", async () => {
    let created: unknown = null;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/trips/t1/categories") && init?.method === "POST") {
        created = JSON.parse(String(init.body));
        return json(
          cat({ id: "c6", name: "Packing", isBuiltin: false, position: 5 }),
          201,
        );
      }
      if (u.endsWith("/trips/t1/categories")) {
        return json([cat(), cat({ id: "c2", name: "Transport", position: 1 })]);
      }
      return json({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderManager();

    // The seeded categories are listed.
    expect(await screen.findByText("Dates")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();

    // Fill the create form and submit.
    fireEvent.change(screen.getByLabelText(/new category/i), {
      target: { value: "Packing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));

    // The POST carried the name (single-choice defaults off).
    await waitFor(() =>
      expect(created).toEqual({ name: "Packing", singleChoice: false }),
    );
  });

  it("surfaces a rename version conflict as a reload prompt", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/trips/t1/categories/c1") && init?.method === "PATCH") {
        return json(
          { message: "This category was changed since you opened it." },
          409,
        );
      }
      if (u.endsWith("/trips/t1/categories")) {
        return json([cat()]);
      }
      return json({ message: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderManager();

    // Enter rename mode and save with a now-stale version.
    fireEvent.click(await screen.findByRole("button", { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/rename dates/i), {
      target: { value: "When" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(
      await screen.findByText(/changed since you opened it/i),
    ).toBeInTheDocument();
  });
});
