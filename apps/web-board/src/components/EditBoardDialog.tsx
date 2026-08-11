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
import { formatAmount, parseAmount, regroupAmountInput } from "../lib/money";

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
  // Outside the resolver, like the create dialog's copy: the field shows a
  // grouped string and the contract wants a number. Seeded already grouped, so
  // the number you set does not come back looking like a different one.
  const [budget, setBudget] = useState(
    trip.budgetPerPerson === null ? "" : formatAmount(trip.budgetPerPerson),
  );

  async function saveCover(file: File) {
    setCoverError(null);
    try {
      await setCover.mutateAsync(file);
    } catch (err) {
      setCoverError(
        err instanceof ApiError
          ? err.message
          : "Couldn't upload that cover. Please try again.",
      );
    }
  }

  async function clearCover() {
    setCoverError(null);
    try {
      await removeCover.mutateAsync();
    } catch (err) {
      setCoverError(
        err instanceof ApiError
          ? err.message
          : "Couldn't remove the cover. Please try again.",
      );
    }
  }
  const {
    register,
    handleSubmit,
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
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : "Could not save changes",
        );
      }
    }
  });

  return (
    <Dialog eyebrow="Edit board" title="Edit trip details" onClose={onClose}>
      <>
        {conflict ? (
          <div>
            <p className="board__form-error" role="alert">
              This board changed since you opened it. Reload to see the latest,
              then re-apply your edit.
            </p>
            <div className="board__dialog-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <Field
              htmlFor="name"
              label="Trip name"
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
              label="Destination"
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
              label="Default currency"
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
              label="Budget per person"
              hint="Optional. A target to read the total against — nothing is blocked for going over. Clear it to remove the target."
            >
              <Input
                id="budgetPerPerson"
                type="text"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                onBlur={(e) => setBudget(regroupAmountInput(e.target.value))}
              />
            </Field>
            {formError ? (
              <p className="board__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="board__dialog-actions">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </div>

            {/* Outside the form's save cycle on purpose: the cover uploads and
                applies on its own, so it carries no `version` and can't trip
                the optimistic-concurrency check the text fields live under. */}
            <ImagePicker
              label="Cover image"
              shape="wide"
              currentUrl={trip.coverImageUrl}
              busy={setCover.isPending || removeCover.isPending}
              error={coverError}
              onSave={(file) => void saveCover(file)}
              onRemove={
                trip.coverImageUrl ? () => void clearCover() : undefined
              }
            />
          </form>
        )}
      </>
    </Dialog>
  );
}
