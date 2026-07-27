import { useEffect, useState } from "react";
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
    <div className="board__backdrop" role="presentation">
      <div
        className="board__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit board"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="board__eyebrow">Edit board</p>
        <h2 className="board__title">Edit trip details</h2>
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
              onRemove={trip.coverImageUrl ? () => void clearCover() : undefined}
            />
          </form>
        )}
      </div>
    </div>
  );
}
