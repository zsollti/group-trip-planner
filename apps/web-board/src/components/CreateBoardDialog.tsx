import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import { dayToIso } from "../lib/dateInput";
import { DateRangeField } from "./DateRangeField";
import { parseAmount, regroupAmountInput } from "../lib/money";
import { onAmountInput } from "../lib/amountField";

/**
 * The questions, in the order a trip is actually decided.
 *
 * Name first because it is the only required one and the only one nobody can
 * guess; money last, because a budget means little until you know roughly what
 * and when the trip is.
 */
interface Step {
  readonly id: "name" | "destination" | "dates" | "currency" | "budget";
  /** The question, as the dialog's heading. */
  readonly title: string;
  /** What the progress list calls it — a name, not the question again. */
  readonly short: string;
  /** Only the name is compulsory; the rest may be skipped outright. */
  readonly required?: boolean;
}

const STEPS: readonly Step[] = [
  {
    id: "name",
    title: "What's the trip called?",
    short: "Name",
    required: true,
  },
  { id: "destination", title: "Where are you going?", short: "Destination" },
  { id: "dates", title: "When?", short: "Dates" },
  { id: "currency", title: "What are prices quoted in?", short: "Currency" },
  { id: "budget", title: "A budget per person?", short: "Budget" },
];

type StepId = Step["id"];

/**
 * Board-paradigm create-trip surface: a card that floats on the canvas. On
 * success it opens the new board.
 *
 * **One question at a time.** It used to be five fields in a column — a name, a
 * destination, a two-month calendar, a currency and a budget — asking for
 * everything at once and burying the only compulsory one among four that were
 * not. Reading it took longer than answering it.
 *
 * So it is a stepper: one question per panel, with the progress said out loud.
 * Four of the five are optional, and their button reads **Skip** until there is
 * something in the field — which teaches that without a form full of
 * "(optional)" suffixes.
 *
 * The `<form>` submits **the step**, not the trip. Enter advances from any
 * field and only the last panel creates anything, which is also what stops a
 * stray Enter in the name box from making a board out of one answer.
 *
 * Dates are optional here (post-launch). A group that already knows when it is
 * going shouldn't have to answer that question twice — supplying them seeds the
 * Dates lane with the decision already locked, and skipping keeps the lane as
 * the open question it was.
 */
export function CreateBoardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const [formError, setFormError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  // Held outside the resolver: the date control speaks "YYYY-MM-DD" and the
  // contract speaks ISO instants, so these are shaped at submit — the same split
  // OptionForm uses for its own date fields.
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
  // Held outside the resolver for the same reason the dates are: the field
  // shows a grouped string and the contract wants a number, so it is shaped at
  // submit. Registering it would also mean overriding react-hook-form's own
  // `onBlur` to regroup, which is how you lose its touched state.
  const [budget, setBudget] = useState("");
  const {
    register,
    getValues,
    trigger,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTripInput>({
    resolver: zodResolver(CreateTripInput),
    defaultValues: { defaultCurrency: "EUR" },
  });

  // Wrapped so a rejected name clears itself as soon as it is fixed. Without
  // this the message from the first Next sits under a field that is now valid,
  // because react-hook-form only re-validates once `handleSubmit` has run —
  // and this form's submit advances a step rather than submitting the trip.
  const nameField = register("name");

  const step = STEPS[stepIndex]!;
  const isLast = stepIndex === STEPS.length - 1;
  // Watched rather than read on render: the Skip/Next label has to follow what
  // is being typed, and `getValues` does not re-render.
  const name = watch("name") ?? "";
  const destination = watch("destination") ?? "";

  /** Is there something in this step? Decides Skip-vs-Next, never whether you may go on. */
  function answered(id: StepId): boolean {
    switch (id) {
      case "name":
        return name.trim() !== "";
      case "destination":
        return destination.trim() !== "";
      case "dates":
        return startDay !== "";
      // Always answered: it ships with a default, so there is nothing to skip.
      case "currency":
        return true;
      case "budget":
        return budget.trim() !== "";
    }
  }

  async function createBoard() {
    setFormError(null);
    try {
      const trip = await createTrip.mutateAsync({
        ...getValues(),
        budgetPerPerson: parseAmount(budget) ?? undefined,
        startDate: dayToIso(startDay),
        endDate: dayToIso(endDay),
      });
      navigate(`/trips/${trip.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not create the board",
      );
    }
  }

  /**
   * Submitting a panel means "I am done with this question".
   *
   * Only the last one creates the trip, so Enter is safe in every field: on the
   * name step it advances rather than making a board out of one answer.
   */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Only the required step gates. The rest may be left empty on purpose, and
    // validating an empty optional field would refuse to let you skip it.
    if (step.required && !(await trigger("name"))) return;
    if (isLast) {
      await createBoard();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  return (
    <Dialog
      eyebrow={`New board · ${stepIndex + 1} of ${STEPS.length}`}
      title={step.title}
      onClose={onClose}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <ol className="steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={
                "steps__dot" +
                (i === stepIndex ? " steps__dot--now" : "") +
                (i < stepIndex ? " steps__dot--done" : "")
              }
              aria-current={i === stepIndex ? "step" : undefined}
            >
              <span className="board__sr-only">{s.short}</span>
            </li>
          ))}
        </ol>

        {/* Only the question being asked is mounted, so nobody can tab into an
            answer they have not been shown. The values live above, so going
            back and forth loses nothing. */}
        {step.id === "name" ? (
          <Field htmlFor="name" label="Trip name" error={errors.name?.message}>
            <Input
              id="name"
              placeholder="Lisbon 2026"
              autoFocus
              invalid={Boolean(errors.name)}
              {...nameField}
              onChange={(e) => {
                void nameField.onChange(e);
                if (errors.name) void trigger("name");
              }}
            />
          </Field>
        ) : null}

        {step.id === "destination" ? (
          <Field
            htmlFor="destination"
            label="Destination"
            error={errors.destination?.message}
            hint="A city, a country, or nothing at all — it can be added later."
          >
            <Input
              id="destination"
              placeholder="Lisbon, Portugal"
              autoFocus
              invalid={Boolean(errors.destination)}
              {...register("destination")}
            />
          </Field>
        ) : null}

        {step.id === "dates" ? (
          <>
            <DateRangeField
              idPrefix="trip"
              legend="Trip dates"
              value={{ start: startDay, end: endDay }}
              onChange={(next) => {
                setStartDay(next.start);
                setEndDay(next.end);
              }}
            />
            {/* Say what filling these in actually does, since it changes the
                board you land on rather than just recording two fields. */}
            <p className="board__field-note">
              {startDay || endDay
                ? "The Dates lane starts with this already decided — unlock it any time to let the group pick instead."
                : "Know them already? The Dates lane will start decided. Skip to let the group vote on it."}
            </p>
          </>
        ) : null}

        {step.id === "currency" ? (
          <Field
            htmlFor="defaultCurrency"
            label="Default currency"
            error={errors.defaultCurrency?.message}
            hint="What prices here are quoted in. An option can still be priced in another."
          >
            <CurrencySelect
              id="defaultCurrency"
              autoFocus
              {...register("defaultCurrency")}
            />
          </Field>
        ) : null}

        {step.id === "budget" ? (
          <Field
            htmlFor="budgetPerPerson"
            label="Budget per person"
            hint="A target to read the total against — nothing is blocked for going over."
          >
            <Input
              id="budgetPerPerson"
              type="text"
              inputMode="decimal"
              autoFocus
              value={budget}
              onChange={(e) => onAmountInput(e, setBudget)}
              onBlur={(e) => setBudget(regroupAmountInput(e.target.value))}
            />
          </Field>
        ) : null}

        {formError ? (
          <p className="board__form-error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="board__dialog-actions">
          {/*
           * Back, and only Back. This button used to be Cancel on the first
           * step and Back on every other one — one control with two unrelated
           * jobs, which meant the button in that position moved you between
           * steps four times out of five and threw the form away the fifth.
           * Abandoning the trip is the corner X now, in the place it is on
           * every other dialog; this stays a step control and disappears when
           * there is no step to go back to.
           */}
          {stepIndex > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Back
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting
              ? "Creating…"
              : isLast
                ? "Create board"
                : // Never "Skip" on the question that cannot be skipped — an
                  // empty required field offered exactly that, which is a
                  // promise the next click breaks.
                  step.required || answered(step.id)
                  ? "Next"
                  : "Skip"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
