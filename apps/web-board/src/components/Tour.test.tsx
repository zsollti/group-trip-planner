import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TourProvider, TourSteps } from "./Tour";
import { useTour } from "../lib/useTour";
import type { TourStep } from "../lib/tour";

/**
 * The tour as it behaves in a document: which panels appear, how it is left,
 * and what it writes when it is.
 *
 * The placement arithmetic is not retested here — it is pure, it lives in
 * `lib/tour`, and jsdom measures every element as zero by zero, so a placement
 * asserted through a render would be asserting against a viewport of nothing.
 * What *does* need a document is the anchor lookup, and it is the thing most
 * likely to break silently: a `data-tour` attribute deleted in a tidy-up leaves
 * a step that simply stops appearing, with no error anywhere.
 */

const saved: unknown[] = [];

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({
      user: { id: "u1", displayName: "Ada", tourCompletedAt: null },
      applyUser: () => undefined,
    }),
    useUpdateProfile: () => ({
      mutate: (input: unknown) => saved.push(input),
      isPending: false,
    }),
  };
});

const STEPS: readonly TourStep[] = [
  { id: "one", anchor: "alpha", title: "First thing", body: "About alpha." },
  { id: "two", anchor: "ghost", title: "Missing thing", body: "Not here." },
  { id: "three", anchor: "beta", title: "Third thing", body: "About beta." },
];

/** A page with two of the three anchors on it, plus a way to start the tour. */
function Harness({ steps = STEPS }: { steps?: readonly TourStep[] }) {
  return (
    <TourProvider>
      <div data-tour="alpha">alpha</div>
      <div data-tour="beta">beta</div>
      <TourSteps steps={steps} />
      <StartButton />
    </TourProvider>
  );
}

function StartButton() {
  const tour = useTour();
  return (
    <button type="button" disabled={!tour.available} onClick={tour.start}>
      Show me around
    </button>
  );
}

const start = () =>
  fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
const next = () =>
  fireEvent.click(screen.getByRole("button", { name: /^(Next|Let's go)$/ }));

describe("running the tour", () => {
  it("shows nothing until it is asked for", () => {
    render(<Harness />);
    expect(screen.queryByText("First thing")).not.toBeInTheDocument();
  });

  it("offers itself only where there is something to point at", () => {
    const { unmount } = render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Show me around" }),
    ).toBeEnabled();
    unmount();

    render(<Harness steps={[]} />);
    expect(
      screen.getByRole("button", { name: "Show me around" }),
    ).toBeDisabled();
  });

  /**
   * The rule the whole thing rests on, asserted end to end: a step whose anchor
   * is not in the document never appears, and — just as importantly — is not
   * counted. "1 of 3" for a tour that will only ever show two panels and a
   * send-off would be counting down to the wrong number.
   */
  it("skips a step whose anchor is missing, and does not count it", () => {
    render(<Harness />);
    start();

    expect(screen.getByText("First thing")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    next();
    expect(screen.queryByText("Missing thing")).not.toBeInTheDocument();
    expect(screen.getByText("Third thing")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("ends on the send-off, whatever the last step was about", () => {
    render(<Harness />);
    start();
    next();
    next();

    // A panel of its own rather than a line tacked onto the last real step:
    // "here is the chat" and "off you go" are different things to say.
    expect(screen.getByText("Let the fun begin!")).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });

  it("goes back to the panel before, skipping the missing one again", () => {
    render(<Harness />);
    start();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("First thing")).toBeInTheDocument();
  });

  it("offers no Back on the first panel", () => {
    render(<Harness />);
    start();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  it("renders into the body, not into the tree that asked for it", () => {
    // A `transform` anywhere up the tree makes a `position: fixed` element
    // position against that element instead of the viewport — the board has
    // one, and it is what once trapped every modal inside the lane row.
    const { container } = render(<Harness />);
    start();
    expect(container.querySelector(".tour")).toBeNull();
    expect(document.body.querySelector(".tour")).not.toBeNull();
  });
});

describe("leaving the tour", () => {
  it("remembers it was seen, whether it was finished or skipped", () => {
    // Both exits are the same write on purpose: a tour that came back after
    // being dismissed would be an advert rather than an offer.
    saved.length = 0;
    const { unmount } = render(<Harness />);
    start();
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(screen.queryByText("First thing")).not.toBeInTheDocument();
    expect(saved).toEqual([{ tourCompleted: true }]);
    unmount();

    saved.length = 0;
    render(<Harness />);
    start();
    next();
    next();
    next();
    expect(saved).toEqual([{ tourCompleted: true }]);
  });

  it("closes on Escape", () => {
    render(<Harness />);
    start();
    // Not translated and never should be — `KeyboardEvent.key` values are not
    // words, and translating them breaks the keyboard.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("First thing")).not.toBeInTheDocument();
  });

  it("steps with the arrow keys", () => {
    render(<Harness />);
    start();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Third thing")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("First thing")).toBeInTheDocument();
  });
});
