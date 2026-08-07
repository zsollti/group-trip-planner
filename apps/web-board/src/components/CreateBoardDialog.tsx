import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";
import { Dialog } from "./Dialog";

/**
 * A `<input type="date">` value ("2026-09-06") as the ISO instant the contract
 * wants — pinned to **midday UTC**, not local midnight.
 *
 * A trip runs on days, and its `startDate`/`endDate` columns are date-only. Local
 * midnight sent from anywhere east of Greenwich lands on the previous day in UTC
 * and gets truncated to it, so a group in Warsaw would pick the 6th and get a
 * trip starting the 5th. Midday leaves twelve hours of slack in either
 * direction.
 */
function dayToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T12:00:00Z`).toISOString();
}

/**
 * Board-paradigm create-trip surface: a card that floats on the canvas. On
 * success it opens the new board.
 *
 * Dates are optional here (post-launch). A group that already knows when it is
 * going shouldn't have to answer that question twice — supplying them seeds the
 * Dates lane with the decision already locked, and leaving them blank keeps the
 * lane as the open question it was.
 */
export function CreateBoardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const [formError, setFormError] = useState<string | null>(null);
  // Held outside the resolver: the date control speaks "YYYY-MM-DD" and the
  // contract speaks ISO instants, so these are shaped at submit — the same split
  // OptionForm uses for its own date fields.
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
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
      const trip = await createTrip.mutateAsync({
        ...data,
        startDate: dayToIso(startDay),
        endDate: dayToIso(endDay),
      });
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
        <div className="board__form-grid">
          <Field htmlFor="startDate" label="Start date" hint="Optional.">
            <Input
              id="startDate"
              type="date"
              value={startDay}
              onChange={(e) => setStartDay(e.target.value)}
            />
          </Field>
          <Field htmlFor="endDate" label="End date" hint="Optional.">
            <Input
              id="endDate"
              type="date"
              value={endDay}
              min={startDay || undefined}
              onChange={(e) => setEndDay(e.target.value)}
            />
          </Field>
        </div>
        {/* Say what filling these in actually does, since it changes the board
            you land on rather than just recording two fields. */}
        <p className="board__field-note">
          {startDay || endDay
            ? "The Dates lane starts with this already decided — unlock it any time to let the group pick instead."
            : "Know them already? The Dates lane will start decided. Leave blank to let the group vote on it."}
        </p>

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
