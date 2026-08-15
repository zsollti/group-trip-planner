import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateRangeField, type DayRange } from "./DateRangeField";

/**
 * The range picker as a control: what the two taps do to the value, and what
 * the native inputs keep doing regardless.
 *
 * The grid arithmetic is unit-tested in `lib/monthGrid`; what is asserted here
 * is the wiring — that the calendar and the two inputs are two ways of editing
 * one value, and that neither can be left behind by the other.
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
        startLabel="Start date"
        endLabel="End date"
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
const openCalendar = () =>
  fireEvent.click(screen.getByRole("button", { name: /pick on a calendar/i }));

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
  it("keeps the calendar shut until it is asked for", () => {
    render(<Harness />);
    expect(screen.queryByRole("table")).toBeNull();
    // The typing path is there from the start — the grid is the enhancement.
    expect(screen.getByLabelText("Start date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("End date")).toHaveAttribute("type", "date");
  });

  it("builds a range from two taps and then closes", () => {
    // Seeded complete, so the first tap starts a new range rather than
    // closing one against the day already there.
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    openCalendar();

    // First tap restarts the range; second closes it.
    fireEvent.click(day("2026-09-06"));
    expect(value()).toBe("2026-09-06|");
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);

    fireEvent.click(day("2026-09-09"));
    expect(value()).toBe("2026-09-06|2026-09-09");
    // The gesture is over, so the panel gets out of the way.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("previews the days between as the pointer moves", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    openCalendar();
    fireEvent.click(day("2026-09-06"));

    const seventh = day("2026-09-07");
    expect(seventh.className).not.toMatch(/between/);
    fireEvent.mouseEnter(day("2026-09-09"));
    // Without this the second tap is a guess at what is being selected.
    expect(day("2026-09-07").className).toMatch(/between/);
  });

  it("restarts rather than inverting when the second tap is earlier", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "2026-09-09" }} />);
    openCalendar();
    fireEvent.click(day("2026-09-09"));
    fireEvent.click(day("2026-09-06"));
    expect(value()).toBe("2026-09-06|");
  });

  it("selects across a month seam without paging first", () => {
    // The trailing cells are the next month's real days, not blanks — a grid
    // that refuses them cannot select a range that crosses the 1st.
    render(<Harness initial={{ start: "2026-09-28", end: "2026-09-30" }} />);
    openCalendar();
    fireEvent.click(day("2026-09-28"));
    fireEvent.click(day("2026-10-02"));
    expect(value()).toBe("2026-09-28|2026-10-02");
  });

  it("still takes a typed date, and refuses an inverted one", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-09-06" },
    });
    expect(value()).toBe("2026-09-06|");
    // The picker cannot make an inverted range; typing still can, so the
    // native control carries the same `min` it always did.
    expect(screen.getByLabelText("End date")).toHaveAttribute(
      "min",
      "2026-09-06",
    );
  });

  it("shades the trip's own dates behind the selection", () => {
    render(<Harness highlight={{ start: "2026-09-06", end: "2026-09-09" }} />);
    openCalendar();
    expect(day("2026-09-07").className).toMatch(/trip/);
    expect(day("2026-09-12").className).not.toMatch(/trip/);
    // Named, because a shaded band that explains nothing is decoration.
    expect(screen.getByText(/the trip's own dates/i)).toBeInTheDocument();
  });

  it("opens on the month being worked in, not today's", () => {
    render(<Harness initial={{ start: "2026-09-06", end: "" }} />);
    openCalendar();
    // September is the left month, so its own days are the in-month ones and
    // August's are the borrowed lead — asserted by class rather than by a
    // month name, which is locale text.
    expect(day("2026-09-06").className).not.toMatch(/outside/);
    expect(day("2026-08-31").className).toMatch(/outside/);
  });
});
