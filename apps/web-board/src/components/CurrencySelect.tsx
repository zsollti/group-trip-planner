import { forwardRef, type SelectHTMLAttributes } from "react";
import { currencyChoices } from "@gtp/types";
import { t } from "../lib/i18n";

/**
 * Pick a currency, instead of typing three letters and hoping.
 *
 * The field was a free-text `maxLength={3}` box with the hint "Three-letter
 * code, e.g. EUR." — which asks someone to know that Hungary is HUF and Poland
 * is PLN, and silently accepts DDD if they don't. Every code here is one
 * `Intl` can put a symbol on, so choosing from the list is also what makes the
 * cost strip and the cards render properly.
 *
 * A `<select>` rather than a combobox: sixty-odd options is exactly the size a
 * native select handles well — it is searchable by typing on every platform,
 * it is the control phones render as a proper picker, and it needs no
 * JavaScript, no popover and no focus management of its own.
 *
 * **The list is not the validation.** `currencySchema` still accepts any three
 * uppercase letters, so a trip already denominated in something not listed
 * keeps working — `currencyChoices` prepends whatever the current value is
 * rather than letting the select fall blank and rewrite the field on save.
 */
export const CurrencySelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "children"> & {
    /**
     * The code the field currently holds, so an unlisted one keeps its option.
     * Separate from `value` because the two callers differ: the option form
     * drives this as a controlled input, while the board dialogs hand it to
     * react-hook-form's `register`, which owns the value and never passes one.
     */
    current?: string;
    onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  }
>(function CurrencySelect({ current, value, className, ...rest0 }, ref) {
  const { common, rest } = currencyChoices(
    typeof value === "string" ? value : current,
  );

  return (
    <select
      ref={ref}
      value={value}
      className={["board__select", "board__select--field", className]
        .filter(Boolean)
        .join(" ")}
      {...rest0}
    >
      <optgroup label={t("Common")}>
        {common.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("All currencies")}>
        {rest.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
});
