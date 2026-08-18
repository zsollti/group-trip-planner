import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    useEditOption: () => ({ isPending: false, mutateAsync: () => undefined }),
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
