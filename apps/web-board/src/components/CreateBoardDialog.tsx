import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@gtp/ui-primitives";
import { CreateTripInput } from "@gtp/types";
import { ApiError, useCreateTrip } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import { MoneyInput } from "./MoneyInput";
import { dayToIso } from "../lib/dateInput";
import { DateRangeField } from "./DateRangeField";
import { parseAmount } from "../lib/money";
import { tripDateStepError } from "../lib/tripDateStep";
import { t } from "../lib/i18n";

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

/**
 * The steps, built per render rather than held as a module constant.
 *
 * The constant version is the one hazard `lib/i18n` warns about: `t()` at module
 * scope runs once, at import, so the questions would keep the language that was
 * active when the bundle first loaded while the rest of the dialog followed the
 * reader. The array is five objects — building it per render costs nothing worth
 * measuring, and it cannot be wrong.
 */
function steps(): readonly Step[] {
  return [
    {
      id: "name",
      title: t("What's the trip called?"),
      short: t("Name"),
      required: true,
    },
    {
      id: "destination",
      title: t("Where are you going?"),
      short: t("Destination"),
    },
    { id: "dates", title: t("When?"), short: t("Dates") },
    {
      id: "currency",
      title: t("What are prices quoted in?"),
      short: t("Currency"),
    },
    { id: "budget", title: t("A budget per person?"), short: t("Budget") },
  ];
}

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

  const allSteps = steps();
  const step = allSteps[stepIndex]!;
  const isLast = stepIndex === allSteps.length - 1;
  // Watched rather than read on render: the Skip/Next label has to follow what
  // is being typed, and `getValues` does not re-render.
  const name = watch("name") ?? "";
  const destination = watch("destination") ?? "";
  /**
   * The date answer's problem, as it is given rather than at the end.
   *
   * Derived on every render instead of being stored: it is a function of the
   * two days and nothing else, so there is no state here that could disagree
   * with what the calendar shows.
   */
  const dateError = tripDateStepError(startDay, endDay);

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
        err instanceof ApiError ? err.message : t("Could not create the board"),
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
    // A half-answered or impossible date pair stops here rather than at the
    // end. The message is already on screen by the time this runs — this is
    // what stops the step advancing past it.
    if (step.id === "dates" && dateError) return;
    if (isLast) {
      await createBoard();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  return (
    <Dialog
      eyebrow={t("New board · {step} of {total}", {
        step: stepIndex + 1,
        total: allSteps.length,
      })}
      title={step.title}
      onClose={onClose}
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <ol className="steps" aria-label={t("Progress")}>
          {allSteps.map((s, i) => (
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
          <Field
            htmlFor="name"
            label={t("Trip name")}
            error={errors.name?.message}
          >
            <Input
              id="name"
              placeholder={t("Lisbon 2026")}
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
            label={t("Destination")}
            error={errors.destination?.message}
            hint="A city, a country, or nothing at all — it can be added later."
          >
            <Input
              id="destination"
              placeholder={t("Lisbon, Portugal")}
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
            {/* Immediately, not at the end. This used to surface only when
                "Create board" was pressed two steps later, as a complaint
                about a question the reader had already left behind. */}
            {dateError ? (
              <p className="board__form-error" role="alert">
                {dateError}
              </p>
            ) : null}
            {/* Say what filling these in actually does, since it changes the
                board you land on rather than just recording two fields. */}
            <p className="board__field-note">
              {startDay || endDay
                ? t(
                    "The Dates lane starts with this already decided — unlock it any time to let the group pick instead.",
                  )
                : t(
                    "Know them already? The Dates lane will start decided. Skip to let the group vote on it.",
                  )}
            </p>
          </>
        ) : null}

        {step.id === "currency" ? (
          <Field
            htmlFor="defaultCurrency"
            label={t("Default currency")}
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
            label={t("Budget per person")}
            hint="A target to read the total against — nothing is blocked for going over."
          >
            <MoneyInput
              id="budgetPerPerson"
              autoFocus
              // The step before this one is the currency, so the answer is
              // always already given by the time this is asked — and read off
              // the live form value, not the default, or a trip in forints
              // would ask for its budget marked EUR.
              currency={watch("defaultCurrency") ?? "EUR"}
              value={budget}
              onChange={setBudget}
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
              {t("Back")}
            </Button>
          ) : null}
          {/* Disabled while the dates cannot be used, rather than merely
              refusing on click: a button that looks live and does nothing is
              the same dead end as the late error, moved one step earlier. */}
          <Button
            type="submit"
            variant="primary"
            disabled={
              isSubmitting || (step.id === "dates" && dateError !== null)
            }
          >
            {isSubmitting
              ? t("Creating…")
              : isLast
                ? t("Create board")
                : // Never "Skip" on the question that cannot be skipped — an
                  // empty required field offered exactly that, which is a
                  // promise the next click breaks.
                  step.required || answered(step.id)
                  ? t("Next")
                  : t("Skip")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
