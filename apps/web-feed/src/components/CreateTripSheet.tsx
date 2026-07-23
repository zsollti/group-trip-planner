import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";

/**
 * Feed-paradigm create-trip surface: a bottom sheet that slides up from the FAB.
 * On success it opens the new trip.
 */
export function CreateTripSheet({ onClose }: { onClose: () => void }) {
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
    <div className="feed__sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feed__sheet"
        role="dialog"
        aria-modal="true"
        aria-label="New trip"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feed__sheet-grip" aria-hidden="true" />
        <p className="feed__eyebrow">New trip</p>
        <h2 className="feed__title">Start planning</h2>
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
            label="Where to?"
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
              {isSubmitting ? "Creating…" : "Create trip"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
