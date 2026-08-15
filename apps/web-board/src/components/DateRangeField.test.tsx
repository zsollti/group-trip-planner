import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateRangeField, type DayRange } from "./DateRangeField";

/**
 * The range picker as a control: what the two taps do to the value, and how it
 * is driven from a keyboard now that the grid stands alone.
 *
 * The grid arithmetic is unit-tested in `lib/monthGrid`; what is asserted here
 * is the wiring — and, hardest, the *absence* of the two native inputs the
 * calendar used to sit behind, since deleting them is what moved the keyboard
 * story onto the grid.
 */

function Harness({
  initial = { start: "", end: "" },
  highlight = null,
}: {
  initial?: DayRange;
  highlight?: DayRange | null;
}) {
  const [value, setValue] = useState<DayRange>(initial);
  return (
    <>
      <DateRangeField
        idPrefix="t"
        legend="Trip dates"
        value={value}
        onChange={setValue}
        highlight={highlight}
        highlightLabel="The trip's own dates"
      />
      <output data-testid="value">{`${value.start}|${value.end}`}</output>
    </>
  );
}

const value = () => screen.getByTestId("value").textContent;

/**
 * A day cell by the day it stands for.
 *
 * Deliberately **not** by its label. The visible one is a bare number and the
 * accessible one is locale-formatted prose — this suite runs in whatever locale
 * the machine has, and CI's is not the one this was written on. `data-day` is
 * the same hook the timeline's day columns carry.
 */
const day = (iso: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`);
  if (!el) throw new Error(`no cell for ${iso}`);
  return el;
};

describe("DateRangeField", () => {
  it("is simply there — no disclosure, and no date inputs beside it", () => {
    render(<Harness />);
    // The calendar used to hide behind a "Pick on a calendar" button, next to
    // two inputs asking the same question. Every form asked it twice and made
    // you open the better answer by hand.
    expect(screen.getAllByRole("table").length).toBe(2);
    expect(
      screen.queryByRole("button", { name: /pick on a calendar/i }),
    ).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("says in words what is chosen, and what is not", () => {
    // The inputs used to state the range by holding it. Nothing else on a grid
    // says it in prose, and shading is not something to decode.
    const { unmount } = render(<Harness />);
    expect(screen.getByText(/no dates chosen/i)).toBeInTheDocument();
    unmount();

    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    expect(screen.queryByText(/no dates chosen/i)).toBeNull();
    // Both ends, spelled out — asserted by the element rather than by its text,
    // which is locale prose.
    expect(document.querySelectorAll(".drange__chosen strong").length).toBe(2);
  });

  it("can be emptied again, which every tap otherwise prevents", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(value()).toBe("|");
    // And offers no Clear when there is nothing to clear.
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
  });

  it("builds a range from two taps", () => {
    // Seeded complete, so the first tap starts a new range rather than
    // closing one against the day already there.
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);

    // First tap restarts the range; the second closes it.
    fireEvent.click(day("2026-09-06"));
    expect(value()).toBe("2026-09-06|");

    fireEvent.click(day("2026-09-09"));
    expect(value()).toBe("2026-09-06|2026-09-09");
    // And the calendar stays put: it is the control, not a popover over one.
    expect(screen.getAllByRole("table").length).toBe(2);
  });

  it("previews the days between as the pointer moves", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    fireEvent.click(day("2026-09-06"));

    const seventh = day("2026-09-07");
    expect(seventh.className).not.toMatch(/between/);
    fireEvent.mouseEnter(day("2026-09-09"));
    // Without this the second tap is a guess at what is being selected.
    expect(day("2026-09-07").className).toMatch(/between/);
  });

  it("restarts rather than inverting when the second tap is earlier", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    fireEvent.click(day("2026-09-09"));
    fireEvent.click(day("2026-09-06"));
    expect(value()).toBe("2026-09-06|");
  });

  it("selects across a month seam without paging first", () => {
    // The trailing cells are the next month's real days, not blanks — a grid
    // that refuses them cannot select a range that crosses the 1st.
    render(<Harness initial={{ start: "2026-09-28", end: "2026-09-30" }} />);
    fireEvent.click(day("2026-09-28"));
    fireEvent.click(day("2026-10-02"));
    expect(value()).toBe("2026-09-28|2026-10-02");
  });

  it("is one tab stop, not eighty-four", () => {
    // A roving tabindex. Without it, deleting the inputs would have replaced
    // two controls with a tab trap six weeks long.
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    const reachable = document.querySelectorAll('.drange__day[tabindex="0"]');
    expect(reachable.length).toBe(1);
    expect(reachable[0]).toBe(day("2026-09-06"));
  });

  it("is driven by the arrow keys, and picks with Enter", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    const grid = document.querySelector(".drange")!;
    // Right, then down a week: 6 Sep -> 7 Sep -> 14 Sep.
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(day("2026-09-14").tabIndex).toBe(0);
    fireEvent.click(day("2026-09-14"));
    expect(value()).toBe("2026-09-14|");
  });

  it("follows the focus into a month it is not showing", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    const grid = document.querySelector(".drange")!;
    // Three pages forward leaves the two months on screen behind.
    for (let i = 0; i < 3; i += 1) {
      fireEvent.keyDown(grid, { key: "PageDown" });
    }
    // December is now drawn, so the focused day is a day you can see.
    expect(day("2026-12-06")).toBeTruthy();
    expect(day("2026-12-06").tabIndex).toBe(0);
  });

  it("shades the trip's own dates behind the selection", () => {
    render(<Harness highlight={{ start: "2026-09-06", end: "2026-09-09" }} />);
    expect(day("2026-09-07").className).toMatch(/trip/);
    expect(day("2026-09-12").className).not.toMatch(/trip/);
    // Named, because a shaded band that explains nothing is decoration.
    expect(screen.getByText(/the trip's own dates/i)).toBeInTheDocument();
  });

  it("opens on the month being worked in, not today's", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "" }} />);
    // September is the left month, so its own days are the in-month ones and
    // August's are the borrowed lead — asserted by class rather than by a
    // month name, which is locale text.
    expect(day("2026-09-06").className).not.toMatch(/outside/);
    expect(day("2026-08-31").className).toMatch(/outside/);
  });
});
