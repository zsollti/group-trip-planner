import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyInput } from "./MoneyInput";

/**
 * The amount field, and the one property nothing else can check.
 *
 * `lib/money` covers the regrouping arithmetic and does it properly; this is
 * the place the three moving parts actually meet — the pure regrouping, the
 * caret written back onto the DOM node, and React re-rendering with the value
 * it was handed. Get the last one wrong and the caret jumps to the end of the
 * field on every keystroke, which no unit test of the arithmetic can see.
 *
 * It lived in `CreateBoardDialog.test` until the budget stopped being one of
 * that dialog's questions. It moved here rather than going away with it,
 * because the behaviour did not go away — the trip's target is set from the
 * board's edit dialog now, through this same control.
 */

function Harness() {
  const [value, setValue] = useState("");
  return (
    <MoneyInput id="amount" currency="EUR" value={value} onChange={setValue} />
  );
}

describe("MoneyInput", () => {
  it("says which currency the number is in", () => {
    render(<Harness />);
    // "500" is half a figure. The code is wired to the input rather than
    // decorated away, so it is announced too.
    expect(screen.getByText("EUR")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-describedby",
      "amount-unit",
    );
  });

  it("groups the amount as it is typed, without moving the caret", () => {
    render(<Harness />);
    const field = screen.getByRole("textbox") as HTMLInputElement;

    /** One keystroke, inserted wherever the caret currently is. */
    function press(digit: string, at = field.selectionStart ?? 0) {
      fireEvent.change(field, {
        target: {
          value: field.value.slice(0, at) + digit + field.value.slice(at),
          selectionStart: at + 1,
          selectionEnd: at + 1,
        },
      });
    }

    for (const digit of [..."5000"]) press(digit);

    // Grouped already, four digits in — not on blur.
    expect(field.value).not.toBe("5000");
    expect(field.value.replace(/\D/g, "")).toBe("5000");

    // Now the case the caret arithmetic exists for: a keystroke in the middle
    // of a short number that pushes it over a grouping boundary, so a separator
    // appears to the *right* of the caret. Retyped from "999" because the
    // insert has to change the grouping — slipping a digit into an
    // already-grouped number leaves the separators where they were, and would
    // assert nothing.
    fireEvent.change(field, { target: { value: "", selectionStart: 0 } });
    for (const digit of [..."999"]) press(digit);
    press("1", 1);

    expect(field.value.replace(/\D/g, "")).toBe("9199");
    expect(field.value).not.toBe("9199");
    // The typed "1" is the second digit, so two digits sit to the caret's left
    // — "9 1|99". Without the handler writing the selection back, the separator
    // that appeared ahead of the caret leaves it a character short, on "9 |199".
    const left = field.value.slice(0, field.selectionStart ?? 0);
    expect(left.replace(/\D/g, "")).toBe("91");
  });
});
