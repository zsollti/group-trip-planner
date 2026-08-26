import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/** The session the tour reads, mutable so a test can be somebody else. */
let currentUser: Record<string, unknown> = {
  id: "u1",
  displayName: "Ada",
  tourCompletedAt: null,
  overviewTourCompletedAt: null,
};

vi.mock("@gtp/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@gtp/api-client")>("@gtp/api-client");
  return {
    ...actual,
    useAuth: () => ({
      user: currentUser,
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
function Harness({
  steps = STEPS,
  kind,
  autoStart,
}: {
  steps?: readonly TourStep[];
  kind?: "board" | "overview";
  autoStart?: boolean;
}) {
  return (
    <TourProvider>
      <div data-tour="alpha">alpha</div>
      <div data-tour="beta">beta</div>
      <TourSteps steps={steps} kind={kind} autoStart={autoStart} />
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

/**
 * The two tours are counted separately, and this is the pair of facts that says
 * so. It is worth pinning because getting it wrong is silent: with one shared
 * mark, everything still runs — the overview tour simply switches the board
 * tour off on its way out, and the board one never appears for anybody who was
 * shown the overview first, which is every new account.
 */
describe("two tours, two marks", () => {
  beforeEach(() => {
    saved.length = 0;
    currentUser = {
      id: "u1",
      displayName: "Ada",
      tourCompletedAt: null,
      overviewTourCompletedAt: null,
    };
    vi.useRealTimers();
  });

  it("signs the overview tour off with its own promise", () => {
    render(<Harness kind="overview" />);
    start();
    next();
    next();

    expect(screen.getByText("Now make one")).toBeInTheDocument();
    expect(screen.queryByText("Let the fun begin!")).toBeNull();
  });

  it("marks the overview tour done without touching the board's", () => {
    render(<Harness kind="overview" />);
    start();
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(saved).toEqual([{ overviewTourCompleted: true }]);
  });

  it("still opens the board tour for somebody who has done the overview one", () => {
    vi.useFakeTimers();
    currentUser = {
      ...currentUser,
      overviewTourCompletedAt: "2026-08-26T00:00:00.000Z",
    };
    render(<Harness autoStart />);

    // The tour waits a beat for the board's own requests to land before it
    // decides which steps have anchors — see `TourSteps`.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("First thing")).toBeInTheDocument();
  });

  it("does not open the same tour twice", () => {
    vi.useFakeTimers();
    currentUser = {
      ...currentUser,
      tourCompletedAt: "2026-08-26T00:00:00.000Z",
    };
    render(<Harness autoStart />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("First thing")).toBeNull();
  });
});

describe("the tour's own modality", () => {
  it("takes every click that is not on the bubble", () => {
    /*
     * jsdom applies no stylesheet, so nothing rendered here can show that a
     * click is swallowed — `pointer-events` is a paint-time rule and the class
     * is inert without the sheet that defines it. The rule *is* the behaviour,
     * so the rule is what is read.
     *
     * Worth pinning rather than trusting: this file's own history is a layer
     * that deliberately let clicks through, and turning that back on is a
     * one-word edit that no other test in this suite would notice.
     */
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
      "utf8",
    );
    const layer = /^\.tour \{([^}]*)\}/m.exec(
      css.replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    expect(layer?.[1]).toMatch(/pointer-events:\s*auto/);
  });

  it("still lets the bubble's own buttons be pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(screen.queryByText("First thing")).toBeNull();
  });
});
