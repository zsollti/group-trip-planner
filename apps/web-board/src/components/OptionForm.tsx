import { useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import {
  categoryOptionFields,
  type CategoryBuiltinKey,
  type CostType,
  type OptionView,
} from "@gtp/types";
import { ApiError, useEditOption, useProposeOption } from "@gtp/api-client";
import { Dialog } from "./Dialog";

/** A datetime-local input value ("YYYY-MM-DDTHH:mm") from an ISO string. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Board-paradigm propose/edit card. Covers the FR-21 fields — title, url,
 * description, amount + currency, cost type, fixed-vs-dynamic headcount, optional
 * dates, external ref. On edit it carries the option `version` (a 409 means it
 * changed or is locked → the caller reloads). Validation is delegated to the
 * server contract; only the payload shaping (blanks → omitted, local dates → ISO)
 * happens here.
 *
 * The visible fields are tailored per category ({@link categoryOptionFields}):
 * a Dates option is title/notes/start/end only, since asking "how much does this
 * date range cost per person" never made sense. `currency` is still sent — the
 * contract requires it — but it is the trip's own and never shown.
 */
export function OptionForm({
  tripId,
  categoryId,
  categoryBuiltinKey,
  currency: tripCurrency,
  option,
  onClose,
}: {
  tripId: string;
  categoryId: string;
  categoryBuiltinKey: CategoryBuiltinKey | null;
  currency: string;
  option?: OptionView;
  onClose: () => void;
}) {
  const fields = categoryOptionFields({ builtinKey: categoryBuiltinKey });
  const propose = useProposeOption(tripId, categoryId);
  const edit = useEditOption(tripId, categoryId);
  const isEdit = Boolean(option);

  const [title, setTitle] = useState(option?.title ?? "");
  const [url, setUrl] = useState(option?.url ?? "");
  const [description, setDescription] = useState(option?.description ?? "");
  const [amount, setAmount] = useState(
    option?.amount != null ? String(option.amount) : "",
  );
  const [currency, setCurrency] = useState(option?.currency ?? tripCurrency);
  const [costType, setCostType] = useState<CostType>(
    option?.costType ?? "PER_PERSON",
  );
  const [headcountIsFixed, setHeadcountIsFixed] = useState(
    option?.headcountIsFixed ?? false,
  );
  const [headcount, setHeadcount] = useState(
    option?.headcount != null ? String(option.headcount) : "",
  );
  const [startsAt, setStartsAt] = useState(
    toLocalInput(option?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = useState(toLocalInput(option?.endsAt ?? null));
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      amount: amount.trim() === "" ? undefined : Number(amount),
      currency,
      costType,
      headcountIsFixed,
      headcount:
        headcountIsFixed && headcount.trim() !== ""
          ? Number(headcount)
          : undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
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
      eyebrow={isEdit ? "Edit" : "Propose"}
      title={isEdit ? "Edit option" : "Propose an option"}
      size="wide"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="board__form-grid">
          <div className="board__form-wide">
            <Field htmlFor="opt-title" label="Title">
              <Input
                id="opt-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
          </div>
          <div className="board__form-wide">
            <Field htmlFor="opt-desc" label="Notes (optional)">
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
              <Field htmlFor="opt-url" label="Link (optional)">
                <Input
                  id="opt-url"
                  type="url"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {fields.cost ? (
            <>
              <Field htmlFor="opt-amount" label="Amount (optional)">
                <Input
                  id="opt-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field htmlFor="opt-currency" label="Currency">
                <Input
                  id="opt-currency"
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>

              <Field htmlFor="opt-costtype" label="Cost is">
                <select
                  id="opt-costtype"
                  className="board__select"
                  value={costType}
                  onChange={(e) => setCostType(e.target.value as CostType)}
                >
                  <option value="PER_PERSON">Per person</option>
                  <option value="TOTAL">Total for the group</option>
                </select>
              </Field>
              {headcountIsFixed ? (
                <Field htmlFor="opt-headcount" label="Headcount">
                  <Input
                    id="opt-headcount"
                    type="number"
                    min="1"
                    step="1"
                    value={headcount}
                    onChange={(e) => setHeadcount(e.target.value)}
                  />
                </Field>
              ) : (
                <div />
              )}

              <div className="board__form-wide">
                <label className="board__checkbox">
                  <input
                    type="checkbox"
                    checked={headcountIsFixed}
                    onChange={(e) => setHeadcountIsFixed(e.target.checked)}
                  />
                  <span>
                    Fix the headcount (otherwise it tracks the trip's member
                    count)
                  </span>
                </label>
              </div>
            </>
          ) : null}

          <Field htmlFor="opt-starts" label="Starts (optional)">
            <Input
              id="opt-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field htmlFor="opt-ends" label="Ends (optional)">
            <Input
              id="opt-ends"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
        </div>

        {error ? (
          <p className="board__form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="board__dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !title.trim()}
          >
            {pending ? "Saving…" : isEdit ? "Save option" : "Propose option"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
