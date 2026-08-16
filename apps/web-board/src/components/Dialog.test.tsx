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
    // The shell's own close button, which is last in the DOM even though it is
    // drawn in the top-right corner — so it, not the content's last control,
    // is where the trap wraps from.
    const close = screen.getByRole("button", { name: "Close" });

    // Tab from the last control wraps to the first rather than reaching the
    // page behind — without this, aria-modal="true" would be a false promise.
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // ...and Shift+Tab from the first wraps back to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it("puts initial focus on the content, not on its own close button", () => {
    // The close button is deliberately last in the DOM for exactly this
    // reason. Ordering it first would read better in source and would quietly
    // steal the caret from every dialog that opens on a form — the control
    // would work perfectly and the typing would go nowhere.
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("closes from the corner button", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("scrolls its body, not the whole card", () => {
    // The card must not scroll: the close button is positioned against it, and
    // an absolutely-positioned child of a scrolling box scrolls away with the
    // content. That is the bug this arrangement exists to prevent, and the
    // activity feed — the one dialog whose content grows without limit — is
    // where it showed.
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector(".board__dialog-body")).not.toBeNull();
    expect(screen.getByText("First").closest(".board__dialog-body")).not.toBeNull();
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
