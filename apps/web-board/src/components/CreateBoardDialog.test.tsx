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
 *
 * The dates are chosen on the calendar now — the two `<input type="date">`s are
 * gone. Which days are on screen depends on today, so the cases below read the
 * days out of the grid and assert the *transformation* rather than a literal
 * date, and stay true whenever they are run.
 *
 * The form is also a **stepper**: one question per panel, so every case here
 * walks to the question it is about. `advance()` is that walk, and the fact
 * that the button says Skip or Next is itself asserted below — it is how a
 * reader learns which answers are compulsory.
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

/** The panel's own primary action, whatever it currently says. */
function nextButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /^(Next|Skip|Create board)$/,
  }) as HTMLButtonElement;
}

/** Which panel is showing, read from the "n of 5" the dialog states out loud. */
function currentStep(): number {
  const m = /(\d+) of \d+/.exec(document.body.textContent ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * Walk forward `n` panels, leaving each as it is.
 *
 * Awaited, and asserting that it actually moved: advancing runs the step's
 * validation, which is async, so a synchronous run of clicks lands them all on
 * the first panel and every later assertion fails somewhere confusing.
 */
async function advance(n = 1) {
  for (let i = 0; i < n; i += 1) {
    const before = currentStep();
    fireEvent.click(nextButton());
    await waitFor(() => expect(currentStep()).toBe(before + 1));
  }
}

/** Walk to the panel that asks a given question. */
const STEP = { name: 0, destination: 1, dates: 2, currency: 3, budget: 4 };
async function goTo(step: keyof typeof STEP) {
  await advance(STEP[step]);
}

/**
 * Two days a week apart from the rendered calendar, and the days they are.
 *
 * Read out of the grid rather than typed in, because the calendar opens on the
 * current month: any literal date here would be on screen this month and gone
 * the next.
 */
function pickAWeek(): { start: string; end: string } {
  const cells = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".drange__day[data-day]"),
  );
  // **Strictly after today**, and not merely "row two of the grid".
  //
  // It used to take fixed offsets into the six-week grid, which are days in the
  // past for most of any month — the calendar opens on the current one. That was
  // invisible while nothing checked the dates until the server saw them; now the
  // step refuses a start that has already passed, so a fixture picking last
  // Tuesday fails on the rule rather than on anything it meant to test.
  const today = new Date().toISOString().slice(0, 10);
  const future = cells.filter((c) => c.dataset.day! > today);
  // A week apart, so the range spans a row boundary the way a real one does.
  const first = future[1]!;
  const second = future[8]!;
  fireEvent.click(first);
  fireEvent.click(second);
  return { start: first.dataset.day!, end: second.dataset.day! };
}

describe("CreateBoardDialog dates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits both dates when the fields are left blank", async () => {
    const body = captureCreate();
    renderDialog();

    fill("Trip name", "Someday");
    // Straight through every optional question without answering one.
    await advance(4);
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
    await goTo("dates");
    const { start, end } = pickAWeek();
    await advance(2);
    fireEvent.click(screen.getByRole("button", { name: "Create board" }));

    await waitFor(() => {
      // Midday, not midnight: local midnight east of Greenwich is the previous
      // day in UTC, and the trip's date-only columns would keep that day. The
      // day is whatever was clicked; the `T12:00:00.000Z` is the point.
      expect(body().startDate).toBe(`${start}T12:00:00.000Z`);
      expect(body().endDate).toBe(`${end}T12:00:00.000Z`);
    });
  });

  /**
   * The money field regroups on every keystroke, and this is the only place the
   * three parts of that meet: the pure regrouping, the caret written back onto
   * the DOM node, and React re-rendering with the value it was handed. The unit
   * tests in `lib/money` cover the arithmetic; what is asserted here is that the
   * component does not throw the caret to the end of the field on the way.
   */
  it("groups the target as it is typed, without moving the caret", async () => {
    renderDialog();
    fill("Trip name", "Lisbon 2026");
    await goTo("budget");
    // By id, not by label: the panel's heading now *is* "A budget per person?",
    // so a loose label query matches the dialog itself as well as the field.
    const field = document.getElementById(
      "budgetPerPerson",
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

  it("says what filling the dates in will do to the board", async () => {
    renderDialog();
    fill("Trip name", "Lisbon 2026");
    await goTo("dates");

    expect(screen.getByText(/the group vote on it/i)).toBeInTheDocument();

    const first = document.querySelector<HTMLButtonElement>(
      ".drange__day[data-day]",
    )!;
    fireEvent.click(first);

    expect(screen.getByText(/unlock it any time/i)).toBeInTheDocument();
  });

  /**
   * The stepper itself. The rules worth pinning are the ones that make five
   * short questions safer than one long form rather than merely prettier: the
   * required one gates, an answer survives going back, and Enter cannot create
   * a trip out of the first panel.
   */
  it("asks one question at a time, and says which of five", () => {
    renderDialog();
    expect(screen.getByText(/1 of 5/)).toBeInTheDocument();
    // Only the current question is mounted, so nothing else is tabbable.
    expect(screen.getByLabelText("Trip name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Destination")).toBeNull();
    expect(document.getElementById("budgetPerPerson")).toBeNull();
  });

  it("will not move past the one answer it needs", async () => {
    renderDialog();
    fireEvent.click(nextButton());
    await waitFor(() => expect(screen.getByText(/1 of 5/)).toBeInTheDocument());
    expect(screen.getByLabelText("Trip name")).toBeInTheDocument();

    fill("Trip name", "Lisbon 2026");
    await advance();
    expect(screen.getByText(/2 of 5/)).toBeInTheDocument();
  });

  it("offers to Skip an empty optional question, and to Next a filled one", async () => {
    renderDialog();
    // The required one never says Skip — not even while it is empty, which is
    // where it would be a promise the next click breaks.
    expect(nextButton().textContent).toBe("Next");
    fill("Trip name", "Lisbon 2026");
    expect(nextButton().textContent).toBe("Next");

    await advance();
    expect(nextButton().textContent).toBe("Skip");
    fill("Destination", "Lisbon, Portugal");
    expect(nextButton().textContent).toBe("Next");
  });

  it("keeps an answer when you go back for it", async () => {
    renderDialog();
    fill("Trip name", "Lisbon 2026");
    await advance();
    fill("Destination", "Lisbon, Portugal");
    await advance();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByText(/2 of 5/)).toBeInTheDocument());
    expect(screen.getByLabelText("Destination")).toHaveValue(
      "Lisbon, Portugal",
    );
  });

  it("does not create a board when Enter is pressed on the first question", async () => {
    // The form submits the *step*. Without that, one Enter in the name box
    // would make a trip with nothing else answered.
    const body = captureCreate();
    renderDialog();
    fill("Trip name", "Lisbon 2026");
    fireEvent.submit(screen.getByLabelText("Trip name").closest("form")!);

    await waitFor(() => expect(screen.getByText(/2 of 5/)).toBeInTheDocument());
    expect(body).toThrow(/has not fired yet/);
  });
});
