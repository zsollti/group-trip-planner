import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import {
  can,
  canManageOption,
  type CategoryView,
  type OptionView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useCategoryOptions,
  useDeleteOption,
  useToggleVote,
} from "@gtp/api-client";
import { OptionForm } from "./OptionForm";

/** Compact money label, e.g. "€ per person" context aside. */
function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${o.amount} ${o.currency}${per}`;
}

/**
 * Board-paradigm dot-voting: one dot per approval vote (the viewer's own dot
 * filled), a toggle to add/remove it, and the public voter list with a stale
 * marker on votes cast before the option's last material edit (FR-22/23). The
 * toggle shows only to voters (`vote.cast`); everyone sees the dots.
 */
function VoteDots({
  tripId,
  category,
  option,
  myRole,
}: {
  tripId: string;
  category: string;
  option: OptionView;
  myRole: TripRole;
}) {
  const toggle = useToggleVote(tripId, category);
  const [error, setError] = useState<string | null>(null);

  async function onToggle() {
    setError(null);
    try {
      await toggle.mutateAsync({
        optionId: option.id,
        hasVoted: option.viewerHasVoted,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not vote");
    }
  }

  return (
    <div className="lane__vote">
      <div className="lane__dots" aria-label={`${option.voteCount} votes`}>
        {option.voters.length === 0 ? (
          <span className="lane__meta">no votes</span>
        ) : (
          option.voters.map((v) => (
            <span
              key={v.userId}
              className={"lane__dot" + (v.stale ? " lane__dot--stale" : "")}
              title={
                v.stale ? `${v.displayName} (stale)` : v.displayName
              }
            />
          ))
        )}
      </div>
      {can(myRole, "vote.cast") ? (
        <button
          type="button"
          className={
            "lane__vote-btn" +
            (option.viewerHasVoted ? " lane__vote-btn--on" : "")
          }
          aria-pressed={option.viewerHasVoted}
          disabled={toggle.isPending}
          onClick={onToggle}
        >
          {option.viewerHasVoted ? "● Voted" : "○ Vote"}
        </button>
      ) : null}
      {error ? (
        <span className="board__form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
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
              <VoteDots
                tripId={tripId}
                category={category.id}
                option={o}
                myRole={myRole}
              />
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
