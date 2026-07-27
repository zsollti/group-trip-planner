import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";
import { Dialog } from "./Dialog";

/**
 * Board-paradigm create-trip surface: a card that floats on the canvas. On
 * success it opens the new board.
 */
export function CreateBoardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateTripInput>({
    resolver: zodResolver(CreateTripInput),
    defaultValues: { defaultCurrency: "EUR" },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      const trip = await createTrip.mutateAsync(data);
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not create the board",
      );
    }
  });

  return (
    <Dialog eyebrow="New board" title="Create a trip board" onClose={onClose}>
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
            {isSubmitting ? "Creating…" : "Create board"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
