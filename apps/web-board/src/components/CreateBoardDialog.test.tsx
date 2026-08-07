import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { CreateBoardDialog } from "./CreateBoardDialog";

/**
 * Optional dates on the create form (post-launch). Functional/DOM only — what
 * matters here is the **shape of the request**, because the server turns these
 * two fields into a pre-locked Dates option and derives the trip's expiry from
 * them.
 *
 * The timezone assertion is the point of the suite. The date control speaks
 * calendar days and the trip's columns are date-only, so sending local midnight
 * from anywhere east of Greenwich truncates to the day before — a group in
 * Warsaw picks the 6th and gets a trip starting the 5th. Midday UTC is what
 * makes that impossible, and it is not the kind of thing anyone re-derives while
 * editing this file later.
 */

function renderDialog() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <CreateBoardDialog onClose={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Capture the JSON body of the POST /trips the dialog fires. */
function captureCreate(): () => Record<string, unknown> {
  const seen: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.includes("/trips") && init?.method === "POST") {
        seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    },
  );
  return () => {
    // Throws until the request has actually gone out, which is what lets the
    // callers wrap this in `waitFor` rather than sleeping.
    const body = seen[0];
    if (!body) throw new Error("POST /trips has not fired yet");
    return body;
  };
}

function fill(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}

describe("CreateBoardDialog dates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits both dates when the fields are left blank", async () => {
    const body = captureCreate();
    renderDialog();

    fill("Trip name", "Someday");
    fireEvent.click(screen.getByRole("button", { name: "Create board" }));

    await waitFor(() => {
      expect(body().startDate).toBeUndefined();
      expect(body().endDate).toBeUndefined();
    });
  });

  it("sends a picked day as midday UTC, so no timezone can shift it", async () => {
    const body = captureCreate();
    renderDialog();

    fill("Trip name", "Lisbon 2026");
    fill("Start date", "2026-09-06");
    fill("End date", "2026-09-13");
    fireEvent.click(screen.getByRole("button", { name: "Create board" }));

    await waitFor(() => {
      // Midday, not midnight: local midnight east of Greenwich is the previous
      // day in UTC, and the trip's date-only columns would keep that day.
      expect(body().startDate).toBe("2026-09-06T12:00:00.000Z");
      expect(body().endDate).toBe("2026-09-13T12:00:00.000Z");
    });
  });

  it("says what filling the dates in will do to the board", () => {
    renderDialog();

    expect(screen.getByText(/the group vote on it/i)).toBeInTheDocument();

    fill("Start date", "2026-09-06");

    expect(screen.getByText(/unlock it any time/i)).toBeInTheDocument();
  });
});
