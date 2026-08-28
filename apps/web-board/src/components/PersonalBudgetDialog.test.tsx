import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@gtp/api-client";
import { PersonalBudgetDialog } from "./PersonalBudgetDialog";

/**
 * The private budget's editor.
 *
 * What is worth pinning is not the form — it is one field — but the two things
 * a reader could get wrong about it: that this figure is **theirs and not the
 * trip's**, and that clearing it is a deliberate action rather than an empty
 * save. A blank field that quietly stored zero would draw a ring saying they
 * are infinitely over, which is the worst answer this panel could give.
 */
describe("PersonalBudgetDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  /** Capture what actually goes over the wire; that is the claim in each case. */
  function stubFetch() {
    const calls: { method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ amount: 600, currency: "EUR" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return calls;
  }

  function open(current: number | null, onClose = () => {}) {
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <PersonalBudgetDialog
          tripId="t1"
          currency="EUR"
          current={current}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
  }

  it("says whose money this is, before anything is typed", () => {
    // The trip's target is one tap away on the same panel. Without this
    // sentence a member could reasonably think they were editing it.
    open(null);
    expect(screen.getByText(/Only you can see this/)).toBeInTheDocument();
    expect(screen.getByText(/separate from the trip's target/)).toBeVisible();
  });

  it("sends the typed figure", async () => {
    const calls = stubFetch();
    open(null);
    fireEvent.change(screen.getByLabelText(/What you can spend/), {
      target: { value: "600" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toEqual({ amount: 600 });
  });

  it("closes itself once the server has agreed, and not before", async () => {
    stubFetch();
    const onClose = vi.fn();
    open(null, onClose);
    fireEvent.change(screen.getByLabelText(/What you can spend/), {
      target: { value: "600" },
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("clears with the button that says so, not with an emptied field", async () => {
    const calls = stubFetch();
    open(600);

    // An emptied field saves nothing. Storing zero here would draw a ring
    // saying the reader is infinitely over their budget.
    fireEvent.change(screen.getByLabelText(/What you can spend/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove budget" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ amount: null });
  });

  it("offers no removal when there is nothing to remove", () => {
    open(null);
    expect(
      screen.queryByRole("button", { name: "Remove budget" }),
    ).not.toBeInTheDocument();
  });

  it("opens on the figure already set, so it is edited rather than retyped", () => {
    open(600);
    expect(screen.getByLabelText(/What you can spend/)).toHaveValue("600");
  });
});
