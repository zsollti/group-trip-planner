import { useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  categoryOptionFields,
  OPTION_TITLE_MAX_LENGTH,
  type CategoryBuiltinKey,
  type CostType,
  type OptionView,
  type ParticipationMode,
  type TripDateRange,
} from "@gtp/types";
import { ApiError, useEditOption, useProposeOption } from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import {
  fromDateInput,
  isoToDayInput,
  joinDay,
  splitDay,
  toDateInput,
} from "../lib/dateInput";
import { DateRangeField } from "./DateRangeField";
import { TimeSelect } from "./TimeSelect";
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
  onClose: () => void;
}) {
  const fields = categoryOptionFields({ builtinKey: categoryBuiltinKey });
  const propose = useProposeOption(tripId, categoryId);
  const edit = useEditOption(tripId, categoryId);
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
    toDateInput(option?.startsAt ?? null, fields.dateGranularity),
  );
  const initialEnd = splitDay(
    toDateInput(option?.endsAt ?? null, fields.dateGranularity),
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
      endsAt: fromDateInput(
        joinDay(endDay, endTime, fields.dateGranularity),
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
                    who, and nothing kept it current. */}
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
                  <option value="OPT_IN">{t("Only whoever's in")}</option>
                </select>
              </Field>
              <div />

              {participationMode === "OPT_IN" ? (
                <div className="board__form-wide">
                  <p className="board__field-note">
                    {tNode(
                      "The card gets an {control} button, and its cost is split between the people who press it — nobody else pays for it. Everyone can see who is in.",
                      { control: <strong>{t("I'm in")}</strong> },
                    )}
                  </p>
                </div>
              ) : null}
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
                      <TimeSelect
                        id="opt-start-time"
                        value={startTime}
                        onChange={changeStartTime}
                        emptyLabel="No time"
                      />
                    </Field>
                    <Field htmlFor="opt-end-time" label={t("End time")}>
                      <TimeSelect
                        id="opt-end-time"
                        value={endTime}
                        onChange={setEndTime}
                        emptyLabel="No time"
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
