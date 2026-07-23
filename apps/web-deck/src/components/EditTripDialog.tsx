import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { UpdateTripInput, type TripDetail } from "@gtp/types";
import { ApiError, useUpdateTrip } from "@gtp/api-client";

/**
 * Deck-paradigm edit-trip surface: the same modal shape as create, pre-filled
 * from the current trip and carrying its `version` for optimistic concurrency.
 * A 409 means someone edited it first — we surface a reload prompt rather than
 * clobbering their change.
 */
export function EditTripDialog({
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
    <div
      className="deck__palette-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="deck__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit trip"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="deck__eyebrow">Edit trip</p>
        <h2 className="deck__dialog-title">Edit trip details</h2>
        {conflict ? (
          <div>
            <p className="deck__form-error" role="alert">
              This trip changed since you opened it. Reload to see the latest,
              then re-apply your edit.
            </p>
            <div className="deck__dialog-actions">
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
              hint="Three-letter code, e.g. EUR."
            >
              <Input
                id="defaultCurrency"
                maxLength={3}
                invalid={Boolean(errors.defaultCurrency)}
                {...register("defaultCurrency")}
              />
            </Field>
            <Field
              htmlFor="description"
              label="Description"
              error={errors.description?.message}
              hint="Optional."
            >
              <Input
                id="description"
                invalid={Boolean(errors.description)}
                {...register("description")}
              />
            </Field>
            {formError ? (
              <p className="deck__form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="deck__dialog-actions">
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
