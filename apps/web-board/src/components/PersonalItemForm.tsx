import { useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  isHttpUrl,
  PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH,
  PERSONAL_ITEM_TITLE_MAX_LENGTH,
  PERSONAL_ITEM_URL_MAX_LENGTH,
  type CategoryView,
  type PersonalItemView,
  type TripDateRange,
} from "@gtp/types";
import {
  ApiError,
  useCreatePersonalItem,
  useUpdatePersonalItem,
} from "@gtp/api-client";
import { Dialog } from "./Dialog";
import { CurrencySelect } from "./CurrencySelect";
import { DateRangeField } from "./DateRangeField";
import { TimeField } from "./TimeField";
import {
  endDayFor,
  fromDateInput,
  isoToDayInput,
  joinDay,
  splitDay,
  toDateInput,
} from "../lib/dateInput";
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  shiftTime,
  toMinutes,
} from "../lib/timeOfDay";
import { formatAmount, parseAmount, regroupAmountInput } from "../lib/money";
import { onAmountInput } from "../lib/amountField";
import { t } from "../lib/i18n";

/**
 * Add or edit one of the reader's own private items.
 *
 * A sibling of {@link OptionForm} rather than a mode of it. Roughly half of
 * that form is machinery this one has nothing to say about — the cost type, who
 * the option is priced for and the paragraph explaining the difference, the
 * per-category field tailoring, the `version` an edit carries for its
 * 409-reload path. Threading a flag through would have left every second branch
 * reading "except when it is personal". What the two genuinely share — the
 * money parsing, the day/time splitting, the calendar, the currency picker, the
 * link and length checks — they share as imports, which is where the real
 * duplication would have been.
 *
 * Dates are always minute-precision here. An option's granularity comes from
 * its lane, and the Dates lane asks for days because it is proposing the trip's
 * own span; a personal item is never that, and "my flight lands at 06:20" is
 * the entire reason someone puts one on a timeline.
 */
export function PersonalItemForm({
  tripId,
  myUserId,
  categories,
  currency: tripCurrency,
  item,
  tripDates = null,
  onClose,
}: {
  tripId: string;
  /** The reader — a cache key for the write's own list. See {@link PersonalLane}. */
  myUserId: string | undefined;
  /** The trip's lanes, offered as an optional tag. */
  categories: readonly CategoryView[];
  currency: string;
  item?: PersonalItemView;
  /** The trip's settled span, shaded behind the calendar. */
  tripDates?: TripDateRange | null;
  onClose: () => void;
}) {
  const create = useCreatePersonalItem(tripId, myUserId ?? "");
  const update = useUpdatePersonalItem(tripId, myUserId ?? "");
  const isEdit = Boolean(item);

  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState(
    item?.amount != null ? formatAmount(item.amount) : "",
  );
  const [currency, setCurrency] = useState(item?.currency ?? tripCurrency);
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");

  const initialStart = splitDay(toDateInput(item?.startsAt ?? null, "minute"));
  const initialEnd = splitDay(toDateInput(item?.endsAt ?? null, "minute"));
  const [startDay, setStartDay] = useState(initialStart.day);
  const [startTime, setStartTime] = useState(
    initialStart.time || DEFAULT_START_TIME,
  );
  const [endDay, setEndDay] = useState(initialEnd.day);
  const [endTime, setEndTime] = useState(initialEnd.time || DEFAULT_END_TIME);

  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    description?: string;
    url?: string;
  }>({});

  function setDays(next: { start: string; end: string }) {
    setStartDay(next.start);
    setEndDay(next.end);
  }

  /** Moving the start carries the end with it, keeping the gap — the same rule
   *  the option form follows, and for the same reason. */
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

  const tripRange = tripDates
    ? {
        start: isoToDayInput(tripDates.startDate),
        end: isoToDayInput(tripDates.endDate),
      }
    : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);

    const found: { description?: string; url?: string } = {};
    if (description.trim().length > PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH) {
      found.description = t(
        "That's {n} characters too long. The notes hold {max}.",
        {
          n: description.trim().length - PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH,
          max: PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH,
        },
      );
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      found.url = t("A link has to start with http:// or https://");
    } else if (trimmedUrl.length > PERSONAL_ITEM_URL_MAX_LENGTH) {
      found.url = t("That link is too long.");
    }
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;

    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      amount: parseAmount(amount) ?? undefined,
      currency,
      // "" is the no-tag option, and the contract reads null as "untagged".
      // Sent explicitly rather than omitted: the body is a full replace, so an
      // absent field would clear the tag anyway — but saying so is what makes
      // "clear the tag" and "I forgot to mention the tag" different requests.
      categoryId: categoryId || null,
      startsAt: fromDateInput(joinDay(startDay, startTime, "minute"), "minute"),
      // `endDayFor`, not `endDay`: a single-day item is one tap on the calendar
      // and two times, which leaves the end day blank — and an end time with no
      // day is not an instant.
      endsAt: fromDateInput(
        joinDay(
          endDayFor(startDay, endDay, endTime, "minute"),
          endTime,
          "minute",
        ),
        "minute",
      ),
    };

    try {
      if (item) {
        await update.mutateAsync({ itemId: item.id, ...body });
      } else {
        await create.mutateAsync(body);
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("Could not save the item"),
      );
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog
      title={isEdit ? t("Edit your item") : t("Add something just for you")}
      quietTitle
      size="wide"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="board__form-grid">
          <div className="board__form-wide">
            <Field htmlFor="pers-title" label={t("Title")} required>
              <Input
                id="pers-title"
                value={title}
                maxLength={PERSONAL_ITEM_TITLE_MAX_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
          </div>

          {/*
           * The tag, and the one field on this form with no equivalent on an
           * option's. It is optional and it is only a colour: the item lives in
           * its own column whatever is chosen here, and the lane it names never
           * learns about it. Worth offering anyway — an untagged item is a grey
           * wedge in the donut and a grey bar on the timeline, beside lanes
           * that are not.
           */}
          <div className="board__form-wide">
            <Field
              htmlFor="pers-category"
              label={t("Counts as")}
              hint={t("Only sets its colour on the charts and the timeline.")}
            >
              <select
                id="pers-category"
                className="board__select board__select--field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t("Nothing in particular")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="board__form-wide">
            <Field
              htmlFor="pers-desc"
              label={t("Notes")}
              error={fieldErrors.description}
              hint={t("{n}/{max}", {
                n: description.trim().length,
                max: PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH,
              })}
            >
              <textarea
                id="pers-desc"
                data-gtp-input
                className="board__textarea"
                rows={4}
                maxLength={PERSONAL_ITEM_DESCRIPTION_MAX_LENGTH}
                value={description}
                aria-invalid={fieldErrors.description ? true : undefined}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (fieldErrors.description) {
                    setFieldErrors((f) => ({ ...f, description: undefined }));
                  }
                }}
              />
            </Field>
          </div>

          <div className="board__form-wide">
            <Field htmlFor="pers-url" label={t("Link")} error={fieldErrors.url}>
              <Input
                id="pers-url"
                type="url"
                placeholder={t("https://…")}
                maxLength={PERSONAL_ITEM_URL_MAX_LENGTH}
                value={url}
                invalid={Boolean(fieldErrors.url)}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (fieldErrors.url) {
                    setFieldErrors((f) => ({ ...f, url: undefined }));
                  }
                }}
              />
            </Field>
          </div>

          {/* No "cost is" and no "priced for". This is what you pay: there is
              no headcount to read it against and nobody to split it with. */}
          <Field htmlFor="pers-amount" label={t("Amount")}>
            <Input
              id="pers-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmountInput(e, setAmount)}
              onBlur={(e) => setAmount(regroupAmountInput(e.target.value))}
            />
          </Field>
          <Field htmlFor="pers-currency" label={t("Currency")}>
            <CurrencySelect
              id="pers-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </Field>

          <div className="board__form-wide">
            <DateRangeField
              idPrefix="pers"
              legend={t("When")}
              value={{ start: startDay, end: endDay }}
              onChange={setDays}
              highlight={tripRange}
              highlightLabel="The trip's own dates"
              extra={
                <div className="board__form-grid">
                  <Field htmlFor="pers-start-time" label={t("Start time")}>
                    <TimeField
                      id="pers-start-time"
                      value={startTime}
                      onChange={changeStartTime}
                    />
                  </Field>
                  <Field htmlFor="pers-end-time" label={t("End time")}>
                    <TimeField
                      id="pers-end-time"
                      value={endTime}
                      onChange={setEndTime}
                    />
                  </Field>
                </div>
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

        <div className="board__dialog-actions">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? t("Saving…") : isEdit ? t("Save item") : t("Add item")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
