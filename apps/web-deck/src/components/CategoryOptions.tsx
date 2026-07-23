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

function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${o.amount} ${o.currency}${per}`;
}

/**
 * Deck-paradigm option manifest for one category: option rows with cost/proposer
 * metadata, an Add-option action (Participant+), and edit/delete on rows the
 * caller may manage (`canManageOption`, the same rule the API enforces). Locked
 * options are badged and their edit is blocked server-side.
 */
export function CategoryOptions({
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
    <div className="deck__cat-block">
      <div className="deck__cat-block-head">
        <div>
          <strong>{category.name}</strong>{" "}
          <span className="deck__muted">
            {category.singleChoice ? "single-choice" : "multi-select"}
          </span>
        </div>
        {can(myRole, "option.propose") ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setProposing(true)}
          >
            + Option
          </Button>
        ) : null}
      </div>

      {options.isPending ? (
        <p className="deck__muted">Loading options…</p>
      ) : options.isError ? (
        <p className="deck__muted">Couldn't load options.</p>
      ) : options.data.length === 0 ? (
        <p className="deck__muted">No options yet.</p>
      ) : (
        <ul className="deck__opt-rows">
          {options.data.map((o) => {
            const manageable = canManageOption(
              myRole,
              o.proposerId === myUserId,
            );
            return (
              <li key={o.id} className="deck__opt-row">
                <div className="deck__opt-main">
                  <span>
                    <strong>{o.title}</strong>
                    {o.status === "LOCKED" ? (
                      <span className="deck__badge"> Locked</span>
                    ) : null}
                    {o.url ? (
                      <>
                        {" "}
                        <a
                          className="deck__opt-link"
                          href={o.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          ↗
                        </a>
                      </>
                    ) : null}
                  </span>
                  <span className="deck__muted">
                    {costLabel(o) ? `${costLabel(o)} · ` : ""}
                    {o.proposerName}
                    {o.materialChangedAt ? " · edited" : ""}
                  </span>
                </div>
                {manageable && o.status !== "LOCKED" ? (
                  <div className="deck__opt-actions">
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
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="deck__form-error" role="alert">
          {error}
        </p>
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
    </div>
  );
}
