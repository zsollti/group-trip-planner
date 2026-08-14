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

  /**
   * The money field regroups on every keystroke, and this is the only place the
   * three parts of that meet: the pure regrouping, the caret written back onto
   * the DOM node, and React re-rendering with the value it was handed. The unit
   * tests in `lib/money` cover the arithmetic; what is asserted here is that the
   * component does not throw the caret to the end of the field on the way.
   */
  it("groups the target as it is typed, without moving the caret", () => {
    renderDialog();
    const field = screen.getByLabelText(
      /budget per person/i,
    ) as HTMLInputElement;

    /** One keystroke, inserted wherever the caret currently is. */
    function press(digit: string, at = field.selectionStart ?? 0) {
      fireEvent.change(field, {
        target: {
          value: field.value.slice(0, at) + digit + field.value.slice(at),
          selectionStart: at + 1,
          selectionEnd: at + 1,
        },
      });
    }

    for (const digit of [..."5000"]) press(digit);

    // Grouped already, four digits in — not on blur.
    expect(field.value).not.toBe("5000");
    expect(field.value.replace(/\D/g, "")).toBe("5000");

    // Now the case the caret arithmetic exists for: a keystroke in the middle
    // of a short number that pushes it over a grouping boundary, so a separator
    // appears to the *right* of the caret. Retyped from "999" because the
    // insert has to change the grouping — slipping a digit into an
    // already-grouped number leaves the separators where they were, and would
    // assert nothing.
    fireEvent.change(field, { target: { value: "", selectionStart: 0 } });
    for (const digit of [..."999"]) press(digit);
    press("1", 1);

    expect(field.value.replace(/\D/g, "")).toBe("9199");
    expect(field.value).not.toBe("9199");
    // The typed "1" is the second digit, so two digits sit to the caret's left
    // — "9 1|99". Without the handler writing the selection back, the separator
    // that appeared ahead of the caret leaves it a character short, on "9 |199".
    const left = field.value.slice(0, field.selectionStart ?? 0);
    expect(left.replace(/\D/g, "")).toBe("91");
  });

  it("says what filling the dates in will do to the board", () => {
    renderDialog();

    expect(screen.getByText(/the group vote on it/i)).toBeInTheDocument();

    fill("Start date", "2026-09-06");

    expect(screen.getByText(/unlock it any time/i)).toBeInTheDocument();
  });
});
