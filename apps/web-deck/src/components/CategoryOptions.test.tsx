import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, setAccessToken } from "@gtp/api-client";
import type { CategoryView } from "@gtp/types";
import { CategoryOptions } from "./CategoryOptions";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const category: CategoryView = {
  id: "cat1",
  name: "Accommodation",
  singleChoice: true,
  isBuiltin: true,
  builtinKey: "ACCOMMODATION",
  position: 2,
  version: 0,
};

const option = {
  id: "opt1",
  categoryId: "cat1",
  title: "Airbnb in Alfama",
  description: null,
  url: null,
  amount: 480,
  currency: "EUR",
  costType: "TOTAL",
  headcount: 4,
  headcountIsFixed: true,
  startsAt: null,
  endsAt: null,
  externalRef: null,
  status: "PROPOSED",
  version: 0,
  proposerId: "u1",
  proposerName: "Ada",
  materialChangedAt: null,
  createdAt: new Date().toISOString(),
};

function renderPanel() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CategoryOptions
        tripId="t1"
        category={category}
        defaultCurrency="EUR"
        myRole="PARTICIPANT"
        myUserId="u1"
      />
    </QueryClientProvider>,
  );
}

describe("web-deck CategoryOptions (Phase 2.2)", () => {
  beforeEach(() => {
    setAccessToken("access-token");
    vi.restoreAllMocks();
  });

  it("lists an option with its cost and shows manage controls to the proposer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([option])),
    );

    renderPanel();

    expect(await screen.findByText("Airbnb in Alfama")).toBeInTheDocument();
    expect(screen.getByText(/480 EUR total/)).toBeInTheDocument();
    // The proposer (u1) sees edit/delete.
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("proposes a new option through the form", async () => {
    let posted: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/categories/cat1/options") && init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return json({ ...option, id: "opt2", title: "Hostel" }, 201);
        }
        return json([]); // list starts empty
      }),
    );

    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /\+ option/i }));
    fireEvent.change(await screen.findByLabelText(/^title$/i), {
      target: { value: "Hostel" },
    });
    fireEvent.click(screen.getByRole("button", { name: /propose option/i }));

    await waitFor(() =>
      expect((posted as { title: string }).title).toBe("Hostel"),
    );
    expect((posted as { costType: string }).costType).toBe("PER_PERSON");
  });
});
