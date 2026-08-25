import { useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  categoryOptionFields,
  OPTION_TITLE_MAX_LENGTH,
  type CategoryBuiltinKey,
  type CategoryView,
  type CostType,
  type OptionView,
  type ParticipationMode,
  type TripDateRange,
} from "@gtp/types";
import { ApiError, useEditOption, useProposeOption } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import {
  endDayFor,
  fromDateInput,
  isoToDayInput,
  joinDay,
  splitDay,
  toDateInput,
} from "../lib/dateInput";
import { DateRangeField } from "./DateRangeField";
import { TimeField } from "./TimeField";
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  shiftTime,
  toMinutes,
} from "../lib/timeOfDay";
import { formatAmount, parseAmount, regroupAmountInput } from "../lib/money";
import { onAmountInput } from "../lib/amountField";
import { t, tNode } from "../lib/i18n";

/**
 * Board-paradigm propose/edit card. Covers the FR-21 fields — title, url,
 * description, amount + currency, cost type, who it is priced for, optional
 * dates, external ref. On edit it carries the option `version` (a 409 means it
 * changed or is locked → the caller reloads). Validation is delegated to the
 * server contract; only the payload shaping (blanks → omitted, local dates → ISO)
 * happens here.
 *
 * The visible fields are tailored per category ({@link categoryOptionFields}):
 * a Dates option is title/notes/start/end only, since asking "how much does this
 * date range cost per person" never made sense. `currency` is still sent — the
 * contract requires it — but it is the trip's own and never shown.
 *
 * The same call picks the **date control**. Both granularities pick their days
 * on one {@link DateRangeField} — a start and an end are a span, and asking for
 * them as two unrelated fields never showed them as one. A Dates option is days
 * alone, stored as a midday-UTC instant; everywhere else the dates say when
 * *within* the trip something happens, where 07:15 is the whole point, so those
 * add a time beside the grid.
 */
export function OptionForm({
  tripId,
  categoryId,
  categoryBuiltinKey,
  currency: tripCurrency,
  option,
  tripDates = null,
  categoryChoices,
  seed,
  onProposed,
  onClose,
}: {
  tripId: string;
  categoryId: string;
  categoryBuiltinKey: CategoryBuiltinKey | null;
  currency: string;
  option?: OptionView;
  /** The trip's settled span, shaded behind the calendar so "outside the trip's
   *  dates" is visible while choosing rather than only after saving. */
  tripDates?: TripDateRange | null;
  /**
   * Lanes this option may be proposed into, when the caller does not know.
   *
   * A card opened from a lane has its answer already — the lane it was opened
   * from — and asking again would be a question with one right answer printed
   * above it. The calendar is the case that has none: a click lands on Thursday
   * at 10:00, which says everything about *when* and nothing about *which lane*,
   * so the form asks. `categoryId` is the initial selection either way.
   */
  categoryChoices?: readonly CategoryView[];
  /**
   * When the option should start and end, for a form opened from a time rather
   * than from a lane. ISO instants, read exactly as an existing option's own
   * dates are, so there is one definition of how a date reaches these fields.
   * Ignored on edit — the option's own dates win.
   */
  seed?: { startsAt: string | null; endsAt: string | null };
  /** Fired after a successful propose, before {@link onClose}. */
  onProposed?: () => void;
  onClose: () => void;
}) {
  // Held in state only because the calendar's form lets it be changed; a form
  // opened from a lane initialises here and never moves.
  const [chosenCategoryId, setChosenCategoryId] = useState(categoryId);
  const chosen = categoryChoices?.find((c) => c.id === chosenCategoryId);
  const fields = categoryOptionFields({
    builtinKey: chosen ? chosen.builtinKey : categoryBuiltinKey,
  });
  const propose = useProposeOption(tripId, chosenCategoryId);
  const edit = useEditOption(tripId, chosenCategoryId);
  const isEdit = Boolean(option);

  const [title, setTitle] = useState(option?.title ?? "");
  const [url, setUrl] = useState(option?.url ?? "");
  const [description, setDescription] = useState(option?.description ?? "");
  // Holds what the field *shows*, which is grouped as it is typed. The number
  // is recovered with `parseAmount` on submit rather than tracked in parallel —
  // two states for one value is how they drift apart.
  const [amount, setAmount] = useState(
    option?.amount != null ? formatAmount(option.amount) : "",
  );
  const [currency, setCurrency] = useState(option?.currency ?? tripCurrency);
  const [costType, setCostType] = useState<CostType>(
    option?.costType ?? "PER_PERSON",
  );
  const [participationMode, setParticipationMode] = useState<ParticipationMode>(
    option?.participationMode ?? "WHOLE_GROUP",
  );
  // The day and the time are held apart, because the calendar picks days for
  // both granularities and only a `minute` option has a time at all. They are
  // rejoined on submit; `joinDay` is the single definition of how.
  const initialStart = splitDay(
    toDateInput(
      option?.startsAt ?? seed?.startsAt ?? null,
      fields.dateGranularity,
    ),
  );
  const initialEnd = splitDay(
    toDateInput(option?.endsAt ?? seed?.endsAt ?? null, fields.dateGranularity),
  );
  // An option with no time yet opens at midday, running an hour. Blank was the
  // old answer and `joinDay` turned it into **00:00**, so picking two days on
  // the calendar and saving proposed something that started at midnight — a
  // time nobody chose, and one that reads as a real answer on the card. Midday
  // is the neutral guess; a whole-day option is still made by clearing both.
  const [startDay, setStartDay] = useState(initialStart.day);
  const [startTime, setStartTime] = useState(
    initialStart.time || DEFAULT_START_TIME,
  );
  const [endDay, setEndDay] = useState(initialEnd.day);
  const [endTime, setEndTime] = useState(initialEnd.time || DEFAULT_END_TIME);
  const [error, setError] = useState<string | null>(null);
  // Whether a submit has been turned away for an empty required field. Set on
  // the attempt rather than while typing: a form that goes red before you have
  // finished filling it in is scolding you for not having got there yet.
  const [missing, setMissing] = useState(false);

  function setDays(next: { start: string; end: string }) {
    setStartDay(next.start);
    setEndDay(next.end);
  }

  /**
   * Moving the start carries the end with it, keeping the gap between them.
   *
   * Setting a start and finding the end still where it was is how you get an
   * option that ends before it begins — and on a single-day option that is the
   * common case, not an edge one. Only when both are real times: with the end
   * cleared, the reader has said they don't want one.
   */
  function changeStartTime(next: string) {
    const gap =
      startTime && endTime
        ? (toMinutes(endTime) ?? 0) - (toMinutes(startTime) ?? 0)
        : null;
    setStartTime(next);
    if (next && gap !== null && gap > 0) {
      setEndTime(shiftTime(next, gap) ?? endTime);
    }
  }

  /**
   * The trip's own span as plain days, to shade behind the selection.
   *
   * The trip's dates are calendar days stored as instants, so they go through
   * {@link isoToDayInput} rather than being sliced — read with UTC getters a
   * midday-UTC day is right, but one stored by the old form at local midnight
   * would come back as the day before.
   */
  const tripRange = tripDates
    ? {
        start: isoToDayInput(tripDates.startDate),
        end: isoToDayInput(tripDates.endDate),
      }
    : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    /*
     * Say what is missing, rather than refusing to be pressed.
     *
     * The button used to be `disabled` while the title was empty, which is the
     * tidy-looking version of this and the unhelpful one: a control that cannot
     * be pressed gives the reader nothing to act on and no reason, and on a
     * form this tall the empty field is often scrolled out of sight. Pressing
     * it now names the problem in the place the eye already is — directly above
     * the button — and points back at the asterisk that marked it all along.
     */
    if (!title.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      amount: parseAmount(amount) ?? undefined,
      currency,
      costType,
      participationMode,
      startsAt: fromDateInput(
        joinDay(startDay, startTime, fields.dateGranularity),
        fields.dateGranularity,
      ),
      // `endDayFor`, not `endDay`: a single-day option is one tap on the
      // calendar and two times, which leaves the end day blank — and an end
      // time with no day is not an instant, so the finish the form was showing
      // used to be dropped on save.
      endsAt: fromDateInput(
        joinDay(
          endDayFor(startDay, endDay, endTime, fields.dateGranularity),
          endTime,
          fields.dateGranularity,
        ),
        fields.dateGranularity,
      ),
    };
    try {
      if (option) {
        await edit.mutateAsync({
          optionId: option.id,
          ...body,
          version: option.version,
        });
      } else {
        await propose.mutateAsync(body);
        onProposed?.();
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Could not ${isEdit ? "save" : "propose"} the option`,
      );
    }
  }

  const pending = propose.isPending || edit.isPending;

  return (
    <Dialog
      // Named for a screen reader, not drawn. The first thing on screen is a
      // field labelled "Title"; a heading above it reading "Propose an option"
      // only restates the button that opened the card, and on the board's
      // tallest dialog those two lines are the ones the form needs most.
      title={isEdit ? t("Edit option") : t("Propose an option")}
      quietTitle
      size="wide"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="board__form-grid">
          {/*
           * First, and only where it is a real question.
           *
           * It leads the form rather than sitting with the dates because it is
           * the one field that changes the *rest* of the form: the lane decides
           * whether there is a cost at all and whether the dates carry a time.
           * A reader who fills in a price and then picks the Dates lane would
           * watch what they typed disappear.
           */}
          {categoryChoices ? (
            <div className="board__form-wide">
              <Field htmlFor="opt-category" label={t("Lane")}>
                <select
                  id="opt-category"
                  className="board__select board__select--field"
                  value={chosenCategoryId}
                  onChange={(e) => setChosenCategoryId(e.target.value)}
                >
                  {categoryChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}
          <div className="board__form-wide">
            <Field htmlFor="opt-title" label={t("Title")} required>
              <Input
                id="opt-title"
                value={title}
                maxLength={OPTION_TITLE_MAX_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
          </div>
          <div className="board__form-wide">
            <Field htmlFor="opt-desc" label={t("Notes")}>
              <textarea
                id="opt-desc"
                data-gtp-input
                className="board__textarea"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
          {fields.url ? (
            <div className="board__form-wide">
              <Field htmlFor="opt-url" label={t("Link")}>
                <Input
                  id="opt-url"
                  type="url"
                  placeholder={t("https://…")}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {fields.cost ? (
            <>
              <Field htmlFor="opt-amount" label={t("Amount")}>
                {/* `text` + `inputMode="decimal"`, not `type="number"`: a
                    number input rejects the separators grouping puts in, so the
                    field would blank itself the moment it was formatted. The
                    phone keypad still comes up, and `parseAmount` is stricter
                    about what it accepts than the browser was. */}
                <Input
                  id="opt-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => onAmountInput(e, setAmount)}
                  onBlur={(e) => setAmount(regroupAmountInput(e.target.value))}
                />
              </Field>
              <Field htmlFor="opt-currency" label={t("Currency")}>
                <CurrencySelect
                  id="opt-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                />
              </Field>

              <Field htmlFor="opt-costtype" label={t("Cost is")}>
                <select
                  id="opt-costtype"
                  className="board__select board__select--field"
                  value={costType}
                  onChange={(e) => setCostType(e.target.value as CostType)}
                >
                  <option value="PER_PERSON">{t("Per person")}</option>
                  <option value="TOTAL">{t("Total for the group")}</option>
                </select>
              </Field>
              <Field htmlFor="opt-participation" label={t("Priced for")}>
                {/* Two named choices rather than a checkbox plus a number. The
                    number was the problem: it claimed how many without saying
                    who, and nothing kept it current.

                    "Only whoever's in" named the answer without naming the
                    mechanism, so the one thing a reader needed to know — that
                    somebody has to press a button on the card — was exactly the
                    thing it left out. */}
                <select
                  id="opt-participation"
                  className="board__select board__select--field"
                  value={participationMode}
                  onChange={(e) =>
                    setParticipationMode(e.target.value as ParticipationMode)
                  }
                >
                  <option value="WHOLE_GROUP">
                    {t("Everyone on the trip")}
                  </option>
                  <option value="OPT_IN">{t("Only people who opt in")}</option>
                </select>
              </Field>
              <div />

              {/* Both choices explain themselves, not just the unusual one. The
                  note used to appear only once OPT_IN was already chosen, which
                  is the wrong moment: the difference between the two is what
                  the reader is deciding, and it was invisible until after they
                  had decided. */}
              <div className="board__form-wide">
                <p className="board__field-note">
                  {participationMode === "OPT_IN"
                    ? tNode(
                        "The card gets an {control} button, and its cost is split between the people who press it — nobody else pays for it. Everyone can see who is in.",
                        { control: <strong>{t("I'm in")}</strong> },
                      )
                    : t(
                        "Everyone on the trip pays a share of this. There is nothing to join and nothing to press.",
                      )}
                </p>
              </div>
            </>
          ) : null}

          <div className="board__form-wide">
            <DateRangeField
              idPrefix="opt"
              legend={t("When")}
              value={{ start: startDay, end: endDay }}
              onChange={setDays}
              highlight={tripRange}
              highlightLabel="The trip's own dates"
              // A grid of squares has nowhere to put 07:15, so the days come
              // from the calendar and the time sits with them. Only where the
              // time is the point: a Dates option proposes calendar days.
              extra={
                fields.dateGranularity === "minute" ? (
                  <div className="board__form-grid">
                    <Field htmlFor="opt-start-time" label={t("Start time")}>
                      <TimeField
                        id="opt-start-time"
                        value={startTime}
                        onChange={changeStartTime}
                      />
                    </Field>
                    <Field htmlFor="opt-end-time" label={t("End time")}>
                      <TimeField
                        id="opt-end-time"
                        value={endTime}
                        onChange={setEndTime}
                      />
                    </Field>
                  </div>
                ) : null
              }
            />
          </div>
        </div>

        {missing ? (
          <p className="board__form-error" role="alert">
            {t("Fill in the fields marked with *")}
          </p>
        ) : null}
        {error ? (
          <p className="board__form-error" role="alert">
            {error}
          </p>
        ) : null}

        {/*
         * One button, not two. Cancel and the corner X did the same thing, and
         * a pair where one is destructive-sounding and the other is the only
         * way to commit invites the wrong click — the dangerous half of that
         * pair sat directly beside "Propose option".
         */}
        <div className="board__dialog-actions">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending
              ? t("Saving…")
              : isEdit
                ? t("Save option")
                : t("Propose option")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
