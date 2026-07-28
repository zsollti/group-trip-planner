import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

/**
 * The blank-page guard (Phase 7.5).
 *
 * React unmounts the whole tree when a render throws, so the untreated version
 * of this is a white screen with no text in it. The boundary is only ever
 * exercised by a bug, which means it is the one piece of UI most likely to be
 * broken when it is finally needed — hence a test that actually throws.
 */

function Boom(): never {
  throw new Error("render exploded");
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    // React prints the caught error to console.error by design. Silence it so
    // a passing run is not full of a stack trace the test deliberately caused.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>the board</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("the board")).toBeInTheDocument();
  });

  it("shows a recovery message instead of a blank page when a child throws", () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );

    // role="alert" is the part that matters for a screen reader: the tree the
    // user was reading has just been replaced.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/something broke on this page/i);
    expect(
      screen.getByRole("button", { name: /reload the board/i }),
    ).toBeInTheDocument();
  });
});
