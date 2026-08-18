import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToggleSwitch } from "./ToggleSwitch";

/**
 * The switch, and the two properties of it that are easy to lose by accident:
 * its description reaches a screen reader, and its state lives in `aria-checked`
 * rather than in the knob's pixels.
 */
describe("ToggleSwitch", () => {
  const DESC = "Draw the options still being decided.";

  it("points at its description, so the explanation is announced", () => {
    render(
      <ToggleSwitch
        checked={false}
        onChange={() => undefined}
        label="Show proposals"
        description={DESC}
      />,
    );

    const control = screen.getByRole("switch", { name: "Show proposals" });
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The sentence is in the document, and it is the one the switch points at.
    expect(document.getElementById(describedBy!)).toHaveTextContent(DESC);
  });

  it("still announces its state rather than its knob", () => {
    render(
      <ToggleSwitch
        checked
        onChange={() => undefined}
        label="Show proposals"
        description={DESC}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "Show proposals" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("toggles on click", () => {
    const onChange = vi.fn();
    render(
      <ToggleSwitch
        checked={false}
        onChange={onChange}
        label="Show proposals"
        description={DESC}
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Show proposals" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
