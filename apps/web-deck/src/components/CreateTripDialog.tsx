import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";

/**
 * Deck-paradigm create-trip surface: a modal launched from the command palette.
 * On success it routes straight into the new trip's console.
 */
export function CreateTripDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CreateTripInput>({
    resolver: zodResolver(CreateTripInput),
    defaultValues: { defaultCurrency: "EUR" },
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
      const trip = await createTrip.mutateAsync(data);
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not create the trip",
      );
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
        aria-label="Create a trip"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="deck__eyebrow">New trip</p>
        <h2 className="deck__dialog-title">Create a trip</h2>
        <form onSubmit={onSubmit} noValidate>
          <Field htmlFor="name" label="Trip name" error={errors.name?.message}>
            <Input
              id="name"
              placeholder="Lisbon 2026"
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
              placeholder="Lisbon, Portugal"
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
              placeholder="What's the plan?"
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
              {isSubmitting ? "Creating…" : "Create trip"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
