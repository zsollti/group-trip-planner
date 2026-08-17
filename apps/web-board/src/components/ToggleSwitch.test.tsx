import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToggleSwitch } from "./ToggleSwitch";

/**
 * The switch, and one property of it that is easy to lose by accident.
 *
 * `describeOnDemand` hides the description **visually** — the itinerary's strip
 * of chrome could not afford two lines of explanation under a control. The
 * tempting version of that change is to stop rendering the sentence, and it
 * would look identical to a sighted reader while quietly removing the
 * explanation from the one audience that cannot infer it from context. So what
 * is pinned here is that the text is still in the document and still named by
 * `aria-describedby`; whether it is *painted* is a CSS question jsdom has no
 * opinion on, and this deliberately does not pretend otherwise.
 */
describe("ToggleSwitch", () => {
  const DESC = "Draw the options still being decided.";

  it("keeps the description readable to a screen reader when it is hidden", () => {
    render(
      <ToggleSwitch
        checked={false}
        onChange={() => undefined}
        label="Show proposals"
        description={DESC}
        describeOnDemand
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
        describeOnDemand
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
        describeOnDemand
      />,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Show proposals" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
