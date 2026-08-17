import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ViewToggle } from "./ViewToggle";

/**
 * Plan / Timeline.
 *
 * What is worth pinning is not that two labels render — it is that the switch
 * is still **navigation**. The two views share a header, a title and a rail, so
 * they look like one screen with a mode; if this ever became component state,
 * the itinerary would stop being linkable, Back would stop undoing the switch,
 * and every URL anyone had already sent would land on the board instead. The
 * `href` is that promise, so the `href` is what is asserted.
 */
describe("ViewToggle", () => {
  function renderAt(view: "plan" | "timeline") {
    return render(
      <MemoryRouter>
        <ViewToggle tripId="t1" view={view} />
      </MemoryRouter>,
    );
  }

  it("offers both views as real links", () => {
    renderAt("plan");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "href",
      "/trips/t1",
    );
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute(
      "href",
      "/trips/t1/timeline",
    );
  });

  it("marks the view you are looking at, on either side", () => {
    const { unmount } = renderAt("plan");
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Timeline" })).not.toHaveAttribute(
      "aria-current",
    );
    unmount();

    renderAt("timeline");
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps the current view clickable rather than disabling it", () => {
    // A control that disappears when you reach it is how people lose track of
    // where they are — and `aria-current` already says which side is live.
    renderAt("timeline");
    expect(screen.getByRole("link", { name: "Timeline" })).toBeEnabled();
  });
});
