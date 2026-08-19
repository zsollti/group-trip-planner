import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { OptionView } from "@gtp/types";
import { OptionForm } from "./OptionForm";

/**
 * How the option form asks for what it needs.
 *
 * It used to mark the many rather than the few — "(optional)" after five of the
 * seven labels — and enforce the one required field by **disabling** its own
 * submit. Both are tidy-looking and unhelpful: a suffix on nearly every label
 * spends a word each time to say something about the exceptions, and a button
 * that cannot be pressed gives a reader nothing to act on and no reason, on a
 * form tall enough that the empty field is usually scrolled out of sight.
 *
 * So: an asterisk on the one field that must be filled, and a submit that is
 * always pressable and says what is missing when it is. What is pinned here is
 * that pair — the marker, the message, and the fact that the button still works
 * once the field does.
 */

const proposed: unknown[] = [];
const edited: unknown[] = [];

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useProposeOption: () => ({
      isPending: false,
      mutateAsync: (body: unknown) => {
        proposed.push(body);
        return Promise.resolve({});
      },
    }),
    useEditOption: () => ({
      isPending: false,
      mutateAsync: (body: unknown) => {
        edited.push(body);
        return Promise.resolve({});
      },
    }),
  };
});

function renderForm() {
  return render(
    <OptionForm
      tripId="t-1"
      categoryId="c-1"
      categoryBuiltinKey="ACTIVITIES"
      currency="EUR"
      onClose={() => undefined}
    />,
  );
}

describe("what the option form says is required", () => {
  it("marks the field that must be filled, and no longer tags the rest", () => {
    renderForm();
    // The marker rides on the label, so it is read from the rendered label
    // rather than from a class: what matters is that a reader scanning the
    // labels sees it on Title and nowhere else.
    const title = screen.getByText(/^Title/);
    expect(title.textContent).toContain("*");
    expect(screen.getByText("Notes").textContent).not.toContain("optional");
    expect(screen.getByText("Link").textContent).not.toContain("optional");
  });

  it("names the problem instead of refusing to be pressed", () => {
    renderForm();
    const submit = screen.getByRole("button", { name: "Propose option" });
    // Pressable with the title empty — that is the change. A disabled button
    // here was the old behaviour and the reason nothing was ever explained.
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(screen.getByRole("alert").textContent).toMatch(/marked with \*/);
    expect(proposed).toHaveLength(0);
  });

  it("clears the complaint and proposes once the field is filled", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Propose option" }));
    expect(screen.queryByRole("alert")).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Tram 28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose option" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(proposed).toHaveLength(1);
  });
});

/**
 * An option that happens on one day, which is most of them.
 *
 * The calendar says "one day" in a single tap: a start day, and no end day,
 * because there is no second date to give. The two time fields stayed, and the
 * form went on showing an end time — and then dropped it, because `joinDay` was
 * handed a time with no day and a time with no day is not an instant. The card
 * came back with a start and no finish, and the reader who had chosen one had
 * no way to tell why.
 *
 * Driven through the edit form, which starts in exactly that state (a start, no
 * end) without needing a month grid clicked in jsdom — it is the same submit,
 * and the state under test is the one the calendar leaves behind.
 */
describe("an option with a start day and no end day", () => {
  const dated = {
    id: "o-1",
    categoryId: "c-1",
    title: "Dinner",
    description: null,
    url: null,
    amount: null,
    currency: "EUR",
    costType: "PER_PERSON",
    participationMode: "WHOLE_GROUP",
    participants: [],
    viewerIsParticipant: false,
    effectiveHeadcount: 2,
    // 6 September, local — the same reading `toDateInput` takes.
    startsAt: new Date(2026, 8, 6, 19, 0).toISOString(),
    endsAt: null,
    externalRef: null,
    status: "PROPOSED",
    version: 0,
    proposerId: "u1",
    proposerName: "Ada",
    voteCount: 0,
    viewerHasVoted: false,
    voters: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as unknown as OptionView;

  it("finishes on the day it started, at the time the form was showing", () => {
    render(
      <OptionForm
        tripId="t-1"
        categoryId="c-1"
        categoryBuiltinKey="ACTIVITIES"
        currency="EUR"
        option={dated}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "21:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save option" }));

    expect(edited).toHaveLength(1);
    const { startsAt, endsAt } = edited[0] as {
      startsAt?: string;
      endsAt?: string;
    };
    expect(new Date(startsAt!).getHours()).toBe(19);
    // The end is a real instant — it used to be `undefined` — on the start's
    // own day.
    expect(new Date(endsAt!).getHours()).toBe(21);
    expect(new Date(endsAt!).getDate()).toBe(new Date(startsAt!).getDate());
  });
});
