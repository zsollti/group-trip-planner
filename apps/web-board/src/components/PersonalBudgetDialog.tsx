import { useState } from "react";
import { Button, Field } from "@gtp/ui-primitives";
import { useSetPersonalBudget } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { MoneyInput } from "./MoneyInput";
import { formatAmount, parseAmount } from "../lib/money";
import { t } from "../lib/i18n";

/**
 * What this reader is willing to spend on this trip.
 *
 * **Not the trip's target, and the dialog says so out loud.** The two figures
 * sit on the same panel one tap apart, and a member who reads this as "the
 * budget" would be quietly overwriting what they think the organizer set. It is
 * private, it is theirs, and the sentence under the field is the only place
 * either fact can be stated before they type.
 *
 * It lives on the cost panel rather than in Settings for the same reason: the
 * ring it draws is right there, and a number is easiest to choose next to the
 * spending it is being weighed against. Settings is also where the *trip's*
 * fields are, which is precisely the confusion this is avoiding.
 *
 * Clearing it is a first-class action, not an empty save. "Remove" says what
 * happens; submitting a blank field and hoping is how somebody ends up with a
 * budget of zero and a ring that says they are infinitely over.
 */
export function PersonalBudgetDialog({
  tripId,
  currency,
  current,
  onClose,
}: {
  tripId: string;
  /** The trip's currency — this figure has no currency of its own. */
  currency: string;
  /** What it is now, or null when they have never set one. */
  current: number | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(
    current === null ? "" : formatAmount(current),
  );
  const set = useSetPersonalBudget(tripId);

  const save = (next: number | null) => {
    set.mutate(
      { amount: next },
      {
        onSuccess: () => onClose(),
      },
    );
  };

  const parsed = parseAmount(amount);

  return (
    <Dialog title={t("Your budget")} onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // An emptied field saves nothing rather than saving zero. Removing is
          // the button below, which is unambiguous about what it does.
          if (parsed === null) return;
          save(parsed);
        }}
      >
        <Field
          htmlFor="personalBudget"
          label={t("What you can spend on this trip")}
          hint={t(
            "Only you can see this. It counts your share of the group's decisions plus your own things, and it is separate from the trip's target.",
          )}
          error={set.isError ? t("Couldn't save that. Try again.") : undefined}
        >
          <MoneyInput
            id="personalBudget"
            currency={currency}
            value={amount}
            onChange={setAmount}
            autoFocus
          />
        </Field>

        <div className="board__dialog-actions">
          {/* Offered only when there is something to remove, so the dialog does
              not present an action that would do nothing. */}
          {current !== null ? (
            <Button
              type="button"
              variant="ghost"
              disabled={set.isPending}
              onClick={() => save(null)}
            >
              {t("Remove budget")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={set.isPending || parsed === null}>
            {set.isPending ? t("Saving…") : t("Save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
