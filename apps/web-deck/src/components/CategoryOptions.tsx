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
  useLockOption,
  useUnlockOption,
} from "@gtp/api-client";
import { OptionForm } from "./OptionForm";

/**
 * Deck-paradigm lock control (Phase 2.4) — the group-decision surface. Organizers
 * get Lock / Decide (single-choice) and Unlock; everyone else sees a read-only
 * "Decided" tag on a locked option. Locking is **confirmed, never optimistic**:
 * the button shows a pending state and, on a 409 (a concurrent locker won), the
 * hooks refetch so the row snaps to the current decision and an error explains it.
 */
function LockControl({
  tripId,
  category,
  option,
  myRole,
}: {
  tripId: string;
  category: CategoryView;
  option: OptionView;
  myRole: TripRole;
}) {
  const lock = useLockOption(tripId, category.id);
  const unlock = useUnlockOption(tripId, category.id);
  const [error, setError] = useState<string | null>(null);
  const pending = lock.isPending || unlock.isPending;
  const locked = option.status === "LOCKED";

  if (!can(myRole, "decision.lock")) {
    return locked ? (
      <span className="deck__muted deck__decided">
        Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
      </span>
    ) : null;
  }

  async function onLock() {
    setError(null);
    try {
      await lock.mutateAsync({
        optionId: option.id,
        optionVersion: option.version,
        categoryVersion: category.version,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not lock");
    }
  }
  async function onUnlock() {
    setError(null);
    try {
      await unlock.mutateAsync({
        optionId: option.id,
        version: option.version,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not unlock");
    }
  }

  return (
    <div className="deck__lock">
      {locked ? (
        <>
          <span className="deck__muted deck__decided">
            Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onUnlock}
          >
            {unlock.isPending ? "Unlocking…" : "Unlock"}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={onLock}
        >
          {lock.isPending
            ? "Locking…"
            : category.singleChoice
              ? "Decide"
              : "Lock"}
        </Button>
      )}
      {error ? (
        <span className="deck__form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function costLabel(o: OptionView): string | null {
  if (o.amount == null) return null;
  const per = o.costType === "PER_PERSON" ? "/person" : " total";
  return `${o.amount} ${o.currency}${per}`;
}

/**
 * Deck-paradigm vote control: a toggle carrying the live approval tally, plus the
 * public voter list with a stale marker on votes cast before the option's last
 * material edit (FR-22/23). The toggle is shown only to voters (`vote.cast`);
 * everyone sees the tally.
 */
function VoteBar({
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
    <div className="deck__vote">
      {can(myRole, "vote.cast") ? (
        <button
          type="button"
          className={
            "deck__vote-btn" +
            (option.viewerHasVoted ? " deck__vote-btn--on" : "")
          }
          aria-pressed={option.viewerHasVoted}
          disabled={toggle.isPending}
          onClick={onToggle}
        >
          ▲ {option.voteCount}
        </button>
      ) : (
        <span className="deck__vote-count">▲ {option.voteCount}</span>
      )}
      {option.voters.length > 0 ? (
        <span className="deck__vote-who deck__muted">
          {option.voters.map((v, i) => (
            <span
              key={v.userId}
              className={v.stale ? "deck__vote-stale" : undefined}
              title={v.stale ? "Voted before a material change" : undefined}
            >
              {i > 0 ? ", " : ""}
              {v.displayName}
              {v.stale ? " ⚠" : ""}
            </span>
          ))}
        </span>
      ) : null}
      {error ? (
        <span className="deck__form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Deck-paradigm option manifest for one category: option rows with cost/proposer
 * metadata, an Add-option action (Participant+), edit/delete on rows the caller
 * may manage (`canManageOption`, the same rule the API enforces), and an approval
 * vote toggle with a public tally + stale-vote indicator (Phase 2.3). Locked
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
                  <VoteBar
                    tripId={tripId}
                    category={category.id}
                    option={o}
                    myRole={myRole}
                  />
                </div>
                <div className="deck__opt-actions">
                  {manageable && o.status !== "LOCKED" ? (
                    <>
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
                    </>
                  ) : null}
                  <LockControl
                    tripId={tripId}
                    category={category}
                    option={o}
                    myRole={myRole}
                  />
                </div>
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
