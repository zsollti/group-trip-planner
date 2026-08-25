import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimeField } from "./TimeField";

/**
 * The typed time field.
 *
 * The parsing is covered on its own numbers in `lib/timeOfDay`; what is under
 * test here is the plumbing between what is typed and what the form holds —
 * which is where the quarter-hour `<select>` this replaced had nothing to get
 * wrong, and a text field has plenty.
 */
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="t">Start time</label>
      <TimeField id="t" value={value} onChange={setValue} />
      <output data-testid="committed">{value}</output>
    </>
  );
}

const field = () => screen.getByLabelText("Start time") as HTMLInputElement;
const committed = () => screen.getByTestId("committed").textContent;

describe("TimeField", () => {
  it("commits as soon as what is typed is a time, without waiting for blur", () => {
    // Blur looks like the natural moment to commit and quietly depends on the
    // browser firing it before the click that submits the form. A saved time
    // should not rest on that ordering.
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "21:30" } });
    expect(committed()).toBe("21:30");
  });

  it("takes 14:4 as four minutes past two", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "14:4" } });
    expect(committed()).toBe("14:04");
    // …and does not rewrite the text underneath the typist, who may still be
    // reaching for the second digit.
    expect(field().value).toBe("14:4");
    fireEvent.blur(field());
    expect(field().value).toBe("14:04");
  });

  it("lets a value be typed one character at a time", () => {
    // Every prefix of "19:04" passes through this field. None may be refused,
    // and the ones that are already a time may commit.
    render(<Harness />);
    for (const step of ["1", "19", "19:", "19:0", "19:04"]) {
      fireEvent.change(field(), { target: { value: step } });
      expect(field().value).toBe(step);
    }
    expect(committed()).toBe("19:04");
  });

  it("accepts only digits and a separator, five long", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "1p9m:0x4:33" } });
    expect(field().value).toBe("19:04");
  });

  it("puts the last good value back when what is left is not a time", () => {
    render(<Harness initial="12:00" />);
    fireEvent.change(field(), { target: { value: "25:99" } });
    fireEvent.blur(field());
    expect(field().value).toBe("12:00");
    expect(committed()).toBe("12:00");
  });

  it("keeps empty as a real answer", () => {
    render(<Harness initial="12:00" />);
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.blur(field());
    expect(committed()).toBe("");
  });

  it("follows the form when the value is set from outside", () => {
    // The option form seeds both times the first time a day is picked, and
    // re-seeds them when an existing option is opened for editing.
    function Outside() {
      const [value, setValue] = useState("");
      return (
        <>
          <label htmlFor="t">Start time</label>
          <TimeField id="t" value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue("12:00")}>
            seed
          </button>
        </>
      );
    }
    render(<Outside />);
    expect(field().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "seed" }));
    expect(field().value).toBe("12:00");
  });
});
