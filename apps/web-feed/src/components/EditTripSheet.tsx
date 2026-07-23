import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { UpdateTripInput, type TripDetail } from "@gtp/types";
import { ApiError, useUpdateTrip } from "@gtp/api-client";

/**
 * Feed-paradigm edit surface: a bottom sheet pre-filled from the trip, carrying
 * its `version` for optimistic concurrency. A 409 becomes a reload prompt.
 */
export function EditTripSheet({
  trip,
  onClose,
}: {
  trip: TripDetail;
  onClose: () => void;
}) {
  const updateTrip = useUpdateTrip(trip.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    handleSubmit,
    setFocus,
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

  useEffect(() => {
    setFocus("name");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, setFocus]);

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await updateTrip.mutateAsync(data);
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
    <div className="feed__sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feed__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Edit trip"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feed__sheet-grip" aria-hidden="true" />
        <p className="feed__eyebrow">Edit trip</p>
        <h2 className="feed__title">Edit details</h2>
        {conflict ? (
          <div>
            <p className="feed__form-error" role="alert">
              This trip changed since you opened it. Reload to see the latest,
              then re-apply your edit.
            </p>
            <div className="feed__wizard-nav">
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
            <Field htmlFor="name" label="Trip name" error={errors.name?.message}>
              <Input
                id="name"
                invalid={Boolean(errors.name)}
                {...register("name")}
              />
            </Field>
            <Field
              htmlFor="destination"
              label="Where to?"
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
              label="Currency"
              error={errors.defaultCurrency?.message}
              hint="Three-letter code, e.g. EUR."
            >
              <Input
                id="defaultCurrency"
                maxLength={3}
                invalid={Boolean(errors.defaultCurrency)}
                {...register("defaultCurrency")}
              />
            </Field>
            {formError ? (
              <p className="feed__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="feed__wizard-nav">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
