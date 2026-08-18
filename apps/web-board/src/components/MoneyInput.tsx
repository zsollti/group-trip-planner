import { Input } from "@gtp/ui-primitives";
import { onAmountInput } from "../lib/amountField";
import { regroupAmountInput } from "../lib/money";

/**
 * An amount field that says what unit it is in.
 *
 * "Budget per person: 500" is not a figure, it is half of one. The board asks
 * for the trip's currency on the very same panel and then took the number that
 * has to be denominated in it with no mark at all — so a reader who had scrolled
 * past the currency select, or who was editing a trip they set up months ago,
 * had to go and look. The code sits *in* the field, at the end of the number,
 * where a printed figure would carry it.
 *
 * It is live rather than fixed: the currency comes from whatever the form's own
 * select currently says, so changing the trip's currency changes the unit on the
 * budget in the same gesture, instead of leaving a figure labelled with the code
 * it used to be in.
 *
 * The code is announced, not hidden. It is real information about the value
 * being typed, and a screen-reader user has less context for "500" than anyone,
 * not more — so it is wired to the input with `aria-describedby` rather than
 * decorated away.
 */
export function MoneyInput({
  id,
  currency,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  /** The code to print, from the form's own currency field. */
  currency: string;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="moneyfield">
      <Input
        id={id}
        // `text` + `inputMode="decimal"`, not `type="number"`: a number input
        // rejects the separators grouping puts in, so the field would blank
        // itself the moment it was formatted.
        type="text"
        inputMode="decimal"
        autoFocus={autoFocus}
        aria-describedby={`${id}-unit`}
        value={value}
        onChange={(e) => onAmountInput(e, onChange)}
        onBlur={(e) => onChange(regroupAmountInput(e.target.value))}
      />
      <span className="moneyfield__unit" id={`${id}-unit`}>
        {currency}
      </span>
    </div>
  );
}
