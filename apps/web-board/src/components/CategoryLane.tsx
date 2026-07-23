import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canManageOption,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import { ApiError, useCategoryOptions, useDeleteOption } from "@gtp/api-client";
import { OptionForm } from "./OptionForm";

/** Compact money label, e.g. "€ per person" context aside. */
function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${o.amount} ${o.currency}${per}`;
}

/**
 * One board lane = one category, rendering its options as cards (the board
 * paradigm). Participant+ can add a card; the proposer or an Organizer gets
 * edit/delete on a card (the same `canManageOption` rule the API enforces). A
 * locked option is badged and its edit is blocked server-side.
 */
export function CategoryLane({
  tripId,
  category,
  defaultCurrency,
  myRole,
  myUserId,
}: {
  tripId: string;
  category: CategoryView;
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
}) {
  const options = useCategoryOptions(tripId, category.id);
  const deleteOption = useDeleteOption(tripId, category.id);
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState<OptionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete(o: OptionView) {
    setError(null);
    try {
      await deleteOption.mutateAsync(o.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
    }
  }

  return (
    <section className="lane">
      <h2 className="lane__title">{category.name}</h2>
      <p className="lane__meta">
        {category.singleChoice ? "single-choice" : "multi-select"}
      </p>

      {options.isPending ? (
        <p className="lane__meta">Loading…</p>
      ) : options.isError ? (
        <p className="lane__meta">Couldn't load cards.</p>
      ) : options.data.length === 0 ? (
        <div className="lane__card lane__card--ghost">No cards yet</div>
      ) : (
        options.data.map((o) => {
          const manageable = canManageOption(myRole, o.proposerId === myUserId);
          return (
            <article key={o.id} className="lane__card lane__card--option">
              <div className="lane__card-head">
                <strong>{o.title}</strong>
                {o.status === "LOCKED" ? (
                  <span className="lane__lock" title="Locked decision">
                    ✦
                  </span>
                ) : null}
              </div>
              {costLabel(o) ? (
                <p className="lane__cost">{costLabel(o)}</p>
              ) : null}
              {o.url ? (
                <a
                  className="lane__link"
                  href={o.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Link ↗
                </a>
              ) : null}
              <p className="lane__by">
                by {o.proposerName}
                {o.materialChangedAt ? " · edited" : ""}
              </p>
              {manageable && o.status !== "LOCKED" ? (
                <div className="lane__card-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setEditing(o)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={deleteOption.isPending}
                    onClick={() => onDelete(o)}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })
      )}

      {error ? (
        <p className="board__form-error" role="alert">
          {error}
        </p>
      ) : null}

      {can(myRole, "option.propose") ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setProposing(true)}
        >
          + Add card
        </Button>
      ) : null}

      {proposing ? (
        <OptionForm
          tripId={tripId}
          categoryId={category.id}
          currency={defaultCurrency}
          onClose={() => setProposing(false)}
        />
      ) : null}
      {editing ? (
        <OptionForm
          tripId={tripId}
          categoryId={category.id}
          currency={editing.currency}
          option={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
