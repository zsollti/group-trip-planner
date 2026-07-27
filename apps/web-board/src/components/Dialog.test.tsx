import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "./Dialog";

/** A page with a trigger that opens a dialog — the real open/close lifecycle. */
function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="board">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Behind</button>
      {open ? (
        <Dialog
          title="Delete board"
          eyebrow="Danger"
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <button type="button">First</button>
          <button type="button">Last</button>
        </Dialog>
      ) : null}
    </div>
  );
}

describe("Dialog", () => {
  it("is named by its visible heading", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    // The accessible name comes from the rendered <h2>, so it can never drift
    // from what a sighted user reads.
    expect(
      screen.getByRole("dialog", { name: "Delete board" }),
    ).toBeInTheDocument();
  });

  it("moves focus to the first control on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog");
    const first = screen.getByText("First");
    const last = screen.getByText("Last");

    // Tab from the last control wraps to the first rather than reaching the
    // page behind — without this, aria-modal="true" would be a false promise.
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // ...and Shift+Tab from the first wraps back to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to whatever opened it", () => {
    render(<Harness />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(window, { key: "Escape" });
    // Closing hands focus back, so a keyboard user resumes where they were
    // instead of being dropped at the top of the document.
    expect(document.activeElement).toBe(trigger);
  });
});
