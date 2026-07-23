import { useEffect, useState } from "react";
import { Button, Field, Input } from "@gtp/ui-primitives";
import type { CostType, OptionView } from "@gtp/types";
import { ApiError, useEditOption, useProposeOption } from "@gtp/api-client";

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
 */
export function OptionForm({
  tripId,
  categoryId,
  currency: tripCurrency,
  option,
  onClose,
}: {
  tripId: string;
  categoryId: string;
  currency: string;
  option?: OptionView;
  onClose: () => void;
}) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="board__backdrop" role="presentation" onClick={onClose}>
      <form
        className="board__dialog board__dialog--tall"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit option" : "Propose an option"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        noValidate
      >
        <p className="board__eyebrow">{isEdit ? "Edit" : "Propose"}</p>
        <h2 className="board__title">
          {isEdit ? "Edit option" : "Propose an option"}
        </h2>

        <Field htmlFor="opt-title" label="Title">
          <Input
            id="opt-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </Field>
        <Field htmlFor="opt-url" label="Link (optional)">
          <Input
            id="opt-url"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field htmlFor="opt-desc" label="Notes (optional)">
          <Input
            id="opt-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="board__form-row">
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
        </div>

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

        <label className="board__checkbox">
          <input
            type="checkbox"
            checked={headcountIsFixed}
            onChange={(e) => setHeadcountIsFixed(e.target.checked)}
          />
          <span>
            Fix the headcount (otherwise it tracks the trip's member count)
          </span>
        </label>
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
        ) : null}

        <div className="board__form-row">
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
    </div>
  );
}
