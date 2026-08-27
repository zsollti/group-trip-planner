import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CategoryView } from "@gtp/types";
import { TimelineCanvas } from "./TimelineCanvas";

/**
 * The itinerary's one strip of chrome.
 *
 * It used to be a bordered panel with a `role="switch"`, and the switch's own
 * component tests were what covered the overlay control. The strip is a line of
 * text and a pressed chip now, so that coverage came with it: the chip is
 * bespoke here, and what has to stay true of it is what was true of the switch —
 * its state is in an ARIA attribute rather than in its fill, clicking flips it,
 * and the sentence explaining what a proposal looks like on a calendar is still
 * announced to the readers who cannot see one.
 *
 * The two queries are mocked to "still loading". The strip is drawn either way
 * (it reports on a timeline built from whatever has arrived), and this keeps the
 * test about the control rather than about a fixture of decisions — and it is
 * what lets the canvas render without a `QueryClientProvider` around it.
 */

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useCategoriesOptions: () => ({
      byCategory: {},
      isPending: true,
      isError: false,
    }),
    usePersonalItems: () => ({ data: undefined, isPending: true }),
  };
});

const categories: CategoryView[] = [
  {
    id: "c-stay",
    name: "Stay",
    singleChoice: false,
    isBuiltin: true,
    builtinKey: "ACCOMMODATION",
    paletteKey: null,
    position: 0,
    version: 0,
  },
];

function renderCanvas() {
  window.localStorage.clear();
  return render(
    <TimelineCanvas
      tripId="t-1"
      categories={categories}
      myUserId="me"
      tripDates={null}
      defaultCurrency="EUR"
      myRole="PARTICIPANT"
      frozen={false}
    />,
  );
}

describe("the proposals overlay control", () => {
  it("states whether the overlay is on, in the attribute and not the fill", () => {
    renderCanvas();
    const chip = screen.getByRole("button", { name: /Show proposals/ });
    // Off by default: locked options *are* the timeline, and six candidates
    // for one slot is useful while deciding and misleading as a schedule.
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the explanation for a reader who cannot see a dashed card", () => {
    // The chip's label is a verb phrase; what a proposal *looks* like on the
    // calendar is the part that cannot be inferred, and it is the part that
    // stopped being visible when the panel's second line went.
    renderCanvas();
    const chip = screen.getByRole("button", { name: /Show proposals/ });
    const describedBy = chip.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /still being decided/,
    );
  });

  it("remembers the choice per browser", () => {
    const { unmount } = renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: /Show proposals/ }));
    unmount();

    // Re-mounted from storage rather than from a default: a preference that
    // resets on every navigation is one nobody sets twice.
    render(
      <TimelineCanvas
        tripId="t-1"
        categories={categories}
        myUserId="me"
        tripDates={null}
        defaultCurrency="EUR"
        myRole="PARTICIPANT"
        frozen={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Show proposals/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
