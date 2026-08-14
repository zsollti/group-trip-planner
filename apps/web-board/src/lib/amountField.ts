import type { ChangeEvent } from "react";
import { regroupWhileTyping } from "./money";

/**
 * The `onChange` every money field on the board shares.
 *
 * There are three of them — an option's price and the trip's per-person target
 * on both the create and the edit card — and a field that groups as you type in
 * one dialog and only on blur in the next reads as one of them being broken.
 * One handler, so they cannot drift.
 *
 * **The caret is restored on the node inside the handler**, not from an effect
 * afterwards. React then re-renders with the value we are about to store, finds
 * the input already holding it, and leaves the node — and so the selection —
 * alone. Going through an effect would let the browser paint a frame with the
 * caret thrown to the end of the field, which is the jump the digit-counting in
 * {@link regroupWhileTyping} exists to avoid.
 */
export function onAmountInput(
  e: ChangeEvent<HTMLInputElement>,
  set: (value: string) => void,
): void {
  const field = e.target;
  const next = regroupWhileTyping(
    field.value,
    field.selectionStart ?? field.value.length,
  );
  if (next.value !== field.value) {
    field.value = next.value;
    field.setSelectionRange(next.caret, next.caret);
  }
  set(next.value);
}
