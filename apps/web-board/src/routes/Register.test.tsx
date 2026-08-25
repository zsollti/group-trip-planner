import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@gtp/api-client";
import { Register } from "./Register";

/**
 * Signing up, and the four things the form now does that it did not.
 *
 * The password work is worth testing rather than eyeballing because every part
 * of it is a *rule* — reveal state, five gates, a confirmation, a submit that
 * refuses — and rules are exactly what silently stops being true when a
 * component is tidied. The scoring itself is not retested here; it is pure and
 * lives in `@gtp/types`, where `password.spec.ts` covers it properly.
 */

const registered: unknown[] = [];

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({
      register: (input: unknown) => {
        registered.push(input);
        return Promise.resolve();
      },
    }),
  };
});

function mount() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Type a whole value into a controlled field.
 *
 * `fireEvent.change` and not a per-character loop: react-hook-form and the
 * meter both read the field's value, so one change event carrying the final
 * string exercises exactly what a real keystroke sequence ends at, without
 * fifteen renders per assertion.
 */
function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

/** The rule lines, as "✓/✗ label" so both halves are asserted at once. */
function checklist(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((li) => li.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

describe("the sign-up password", () => {
  it("asks for a nickname, not a display name", () => {
    mount();
    expect(screen.getByLabelText("Nickname")).toBeInTheDocument();
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  });

  it("shows no checklist until something is typed", () => {
    mount();
    // Five red lines at someone who has not typed anything is telling them off
    // for the form's own initial state.
    expect(screen.queryByText("Your password needs")).not.toBeInTheDocument();
  });

  /**
   * The brief's worked example, end to end: "1234aA" is meant to mark the
   * number, the small letter and the big letter green while length and special
   * stay red. It is the single assertion that pins all five rules at once and
   * proves the checklist is per-rule rather than one pass/fail dressed up.
   */
  it("marks 1234aA as three rules met and two still missing", async () => {
    mount();
    type(screen.getByLabelText("Password"), "1234aA");

    expect(checklist()).toEqual([
      "✗Still needed: At least 8 characters",
      "✓Done: A lowercase letter",
      "✓Done: An uppercase letter",
      "✓Done: A number",
      "✗Still needed: A special character",
    ]);
  });

  it("turns every rule green once the password clears them", async () => {
    mount();
    type(screen.getByLabelText("Password"), "Trip2026!");
    expect(checklist().every((line) => line.startsWith("✓"))).toBe(true);
  });

  it("says how strong the password is, and changes its mind as it grows", async () => {
    mount();
    const box = screen.getByLabelText("Password");

    type(box, "1234aA");
    expect(screen.getByRole("status")).toHaveTextContent("Weak");

    type(box, "");
    type(box, "Trip2026!");
    expect(screen.getByRole("status")).toHaveTextContent("Normal");

    type(box, "");
    type(box, "Correct-Horse9Battery");
    expect(screen.getByRole("status")).toHaveTextContent("Strong");
  });

  it("reveals and re-hides what was typed", async () => {
    mount();
    const box = screen.getByLabelText("Password");
    expect(box).toHaveAttribute("type", "password");

    // Two reveals on the page — password and confirmation — and this must be
    // the one belonging to the box above it, not whichever came first.
    const [reveal] = screen.getAllByRole("button", { name: "Show password" });
    fireEvent.click(reveal!);
    expect(box).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(box).toHaveAttribute("type", "password");
  });
});

describe("submitting the sign-up form", () => {
  it("refuses to submit while the password fails a rule", async () => {
    mount();
    const submit = screen.getByRole("button", { name: "Create account" });

    expect(submit).toBeDisabled();
    type(screen.getByLabelText("Password"), "1234aA");
    expect(submit).toBeDisabled();
    type(screen.getByLabelText("Password"), "1234aA!!");
    expect(submit).toBeEnabled();
  });

  it("complains on the confirmation box when the two differ", async () => {
    mount();
    type(screen.getByLabelText("Nickname"), "Ada");
    type(screen.getByLabelText("Email"), "ada@example.com");
    type(screen.getByLabelText("Password"), "Trip2026!");
    type(screen.getByLabelText("Password again"), "Trip2026?");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Both passwords must be the same."),
    ).toBeInTheDocument();
    expect(registered).toHaveLength(0);
  });

  it("registers without sending the confirmation to the server", async () => {
    mount();
    type(screen.getByLabelText("Nickname"), "Ada");
    type(screen.getByLabelText("Email"), "ada@example.com");
    type(screen.getByLabelText("Password"), "Trip2026!");
    type(screen.getByLabelText("Password again"), "Trip2026!");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    // The second copy is a property of the typing, not of the account: putting
    // the plaintext on the wire twice would buy nothing.
    expect(registered).toEqual([
      {
        displayName: "Ada",
        email: "ada@example.com",
        password: "Trip2026!",
      },
    ]);
  });

  it("points at the spam folder rather than at the API console", async () => {
    mount();
    type(screen.getByLabelText("Nickname"), "Ada");
    type(screen.getByLabelText("Email"), "ada@example.com");
    type(screen.getByLabelText("Password"), "Trip2026!");
    type(screen.getByLabelText("Password again"), "Trip2026!");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(/spam folder/)).toBeInTheDocument();
    expect(screen.queryByText(/API console/)).not.toBeInTheDocument();
  });
});
