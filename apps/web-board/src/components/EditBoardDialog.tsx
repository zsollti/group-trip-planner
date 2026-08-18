import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { UpdateTripInput, type TripDetail } from "@gtp/types";
import {
  ApiError,
  useRemoveTripCover,
  useSetTripCover,
  useUpdateTrip,
} from "@gtp/api-client";
import { ImagePicker } from "./ImagePicker";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import { MoneyInput } from "./MoneyInput";
import { formatAmount, parseAmount } from "../lib/money";
import { t } from "../lib/i18n";

/**
 * Board-paradigm edit surface: a floating card pre-filled from the trip,
 * carrying its `version` for optimistic concurrency. A 409 becomes a reload
 * prompt rather than overwriting a concurrent edit.
 */
export function EditBoardDialog({
  trip,
  onClose,
}: {
  trip: TripDetail;
  onClose: () => void;
}) {
  const updateTrip = useUpdateTrip(trip.id);
  const setCover = useSetTripCover(trip.id);
  const removeCover = useRemoveTripCover(trip.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  /*
   * The cover, staged rather than applied.
   *
   * It used to commit itself the moment you pressed its own Save, which left
   * this panel with two buttons doing different halves of "edit this trip" —
   * and the one labelled "Save changes" was the one that did *not* save the
   * image. Both intents are held here now and spent by the single submit
   * below: a file to upload, or a decision to clear what is there.
   */
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverCleared, setCoverCleared] = useState(false);
  // Outside the resolver, like the create dialog's copy: the field shows a
  // grouped string and the contract wants a number. Seeded already grouped, so
  // the number you set does not come back looking like a different one.
  const [budget, setBudget] = useState(
    trip.budgetPerPerson === null ? "" : formatAmount(trip.budgetPerPerson),
  );

  /**
   * Apply whatever the reader did to the cover, if anything.
   *
   * Separate from the trip's own update because the two are different requests
   * with different failure modes — the image endpoint has its own size and type
   * rules, and its own rate limit — and reporting them in one place would make
   * "that file is too large" look like a problem with the trip's name. Returns
   * whether it got through, so the caller knows not to close on a failure.
   */
  async function applyCover(): Promise<boolean> {
    setCoverError(null);
    try {
      if (coverFile) await setCover.mutateAsync(coverFile);
      else if (coverCleared) await removeCover.mutateAsync();
      return true;
    } catch (err) {
      setCoverError(
        err instanceof ApiError
          ? err.message
          : coverFile
            ? t("Couldn't upload that cover. Please try again.")
            : t("Couldn't remove the cover. Please try again."),
      );
      return false;
    }
  }
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UpdateTripInput>({
    resolver: zodResolver(UpdateTripInput),
    defaultValues: {
      name: trip.name,
      description: trip.description ?? undefined,
      destination: trip.destination ?? undefined,
      defaultCurrency: trip.defaultCurrency,
      version: trip.version,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await updateTrip.mutateAsync({
        ...data,
        budgetPerPerson: parseAmount(budget) ?? undefined,
      });
      // The trip's own fields first, because they are the ones under the
      // version check: a 409 here means somebody else edited the board, and
      // uploading an image before finding that out would leave a cover applied
      // to a trip whose text edit was refused.
      if (!(await applyCover())) return;
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : t("Could not save changes"),
        );
      }
    }
  });

  return (
    <Dialog title={t("Edit trip details")} onClose={onClose}>
      <>
        {conflict ? (
          <div>
            <p className="board__form-error" role="alert">
              {t(
                "This board changed since you opened it. Reload to see the latest, then re-apply your edit.",
              )}
            </p>
            <div className="board__dialog-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => window.location.reload()}
              >
                {t("Reload")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <Field
              htmlFor="name"
              label={t("Trip name")}
              error={errors.name?.message}
            >
              <Input
                id="name"
                invalid={Boolean(errors.name)}
                {...register("name")}
              />
            </Field>
            <Field
              htmlFor="destination"
              label={t("Destination")}
              error={errors.destination?.message}
              hint="Optional."
            >
              <Input
                id="destination"
                invalid={Boolean(errors.destination)}
                {...register("destination")}
              />
            </Field>
            <Field
              htmlFor="defaultCurrency"
              label={t("Default currency")}
              error={errors.defaultCurrency?.message}
              hint="What prices on this board are quoted in."
            >
              {/* `current` keeps a code that predates the list — or one the
                  regex accepted from the old free-text field — as a real
                  option. Without it the select renders blank and the next save
                  quietly changes the trip's currency. */}
              <CurrencySelect
                id="defaultCurrency"
                current={trip.defaultCurrency}
                {...register("defaultCurrency")}
              />
            </Field>
            <Field
              htmlFor="budgetPerPerson"
              label={t("Budget per person")}
              hint="Optional. A target to read the total against — nothing is blocked for going over. Clear it to remove the target."
            >
              {/* Read off the live select above rather than off the trip, so
                  changing the currency and the budget in one visit never leaves
                  the figure marked with the code it used to be in. */}
              <MoneyInput
                id="budgetPerPerson"
                currency={watch("defaultCurrency") ?? trip.defaultCurrency}
                value={budget}
                onChange={setBudget}
              />
            </Field>

            {/* Inside the panel's own save cycle now — it stages a pick and the
                one button below spends it. It was a picker with a Save of its
                own sitting *under* the form's Save, so the panel had two
                buttons and the one that said "Save changes" saved everything
                except the image directly above it. */}
            <ImagePicker
              label={t("Cover image")}
              shape="wide"
              currentUrl={trip.coverImageUrl}
              removed={coverCleared}
              busy={setCover.isPending || removeCover.isPending}
              error={coverError}
              onPick={(file) => {
                setCoverFile(file);
                // Picking after clearing is a change of mind, not both.
                if (file) setCoverCleared(false);
              }}
              onRemove={
                trip.coverImageUrl ? () => setCoverCleared(true) : undefined
              }
            />

            {formError ? (
              <p className="board__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="board__dialog-actions">
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? t("Saving…") : t("Save changes")}
              </Button>
            </div>
          </form>
        )}
      </>
    </Dialog>
  );
}
