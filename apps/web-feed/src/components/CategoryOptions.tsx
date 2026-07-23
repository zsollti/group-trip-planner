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
 * Feed-paradigm lock control (Phase 2.4). Organizers get Lock / Decide
 * (single-choice) and Unlock; others see a read-only "Decided" stamp on a locked
 * option. Locking is confirmed (pending state, no optimistic flip); a 409 refetch
 * snaps the card to whichever option actually won.
 */
function LockControl({
  tripId,
  category,
  option,
  myRole,
  frozen,
}: {
  tripId: string;
  category: CategoryView;
  option: OptionView;
  myRole: TripRole;
  frozen: boolean;
}) {
  const lock = useLockOption(tripId, category.id);
  const unlock = useUnlockOption(tripId, category.id);
  const [error, setError] = useState<string | null>(null);
  const pending = lock.isPending || unlock.isPending;
  const locked = option.status === "LOCKED";

  if (frozen || !can(myRole, "decision.lock")) {
    return locked ? (
      <span className="feed__decided">
        ✓ Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
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
    <div className="feed__lock">
      {locked ? (
        <>
          <span className="feed__decided">
            ✓ Decided{option.lockedByName ? ` · ${option.lockedByName}` : ""}
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
        <span className="feed__form-error" role="alert">
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
 * Feed-paradigm tap-to-vote control: a heart-style toggle carrying the live
 * approval count, plus the public voter list with a stale marker on votes cast
 * before the option's last material edit (FR-22/23). The toggle shows only to
 * voters (`vote.cast`); everyone sees the count.
 */
function VoteRow({
  tripId,
  category,
  option,
  myRole,
  frozen,
}: {
  tripId: string;
  category: string;
  option: OptionView;
  myRole: TripRole;
  frozen: boolean;
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
    <div className="feed__vote">
      {can(myRole, "vote.cast") && !frozen ? (
        <button
          type="button"
          className={
            "feed__vote-btn" +
            (option.viewerHasVoted ? " feed__vote-btn--on" : "")
          }
          aria-pressed={option.viewerHasVoted}
          disabled={toggle.isPending}
          onClick={onToggle}
        >
          {option.viewerHasVoted ? "♥" : "♡"} {option.voteCount}
        </button>
      ) : (
        <span className="feed__vote-count">♥ {option.voteCount}</span>
      )}
      {option.voters.length > 0 ? (
        <span className="feed__vote-who feed__muted">
          {option.voters.map((v, i) => (
            <span
              key={v.userId}
              className={v.stale ? "feed__vote-stale" : undefined}
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
        <span className="feed__form-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Feed-paradigm option list for one category, rendered as a card with option
 * rows. Participant+ can propose; the proposer or an Organizer gets edit/delete
 * (`canManageOption`, the same rule the API enforces). Each row carries a
 * tap-to-vote toggle with a public tally + stale-vote indicator (Phase 2.3).
 * Locked options are badged and their edit is blocked server-side.
 */
export function CategoryOptions({
  tripId,
  category,
  defaultCurrency,
  myRole,
  myUserId,
  frozen = false,
}: {
  tripId: string;
  category: CategoryView;
  defaultCurrency: string;
  myRole: TripRole;
  myUserId: string | undefined;
  frozen?: boolean;
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
    <section className="feed__card feed__cat-card">
      <div className="feed__cat-head">
        <div>
          <strong>{category.name}</strong>{" "}
          <span className="feed__muted">
            {category.singleChoice ? "single-choice" : "multi-select"}
          </span>
        </div>
        {can(myRole, "option.propose") && !frozen ? (
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
        <p className="feed__muted">Loading options…</p>
      ) : options.isError ? (
        <p className="feed__muted">Couldn't load options.</p>
      ) : options.data.length === 0 ? (
        <p className="feed__muted">No options yet.</p>
      ) : (
        <ul className="feed__opt-rows">
          {options.data.map((o) => {
            const manageable = canManageOption(
              myRole,
              o.proposerId === myUserId,
            );
            return (
              <li key={o.id} className="feed__opt-row">
                <div className="feed__opt-main">
                  <span>
                    <strong>{o.title}</strong>
                    {o.status === "LOCKED" ? (
                      <span className="feed__muted"> · locked</span>
                    ) : null}
                    {o.url ? (
                      <>
                        {" "}
                        <a
                          className="feed__opt-link"
                          href={o.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          ↗
                        </a>
                      </>
                    ) : null}
                  </span>
                  <span className="feed__muted">
                    {costLabel(o) ? `${costLabel(o)} · ` : ""}
                    {o.proposerName}
                    {o.materialChangedAt ? " · edited" : ""}
                  </span>
                  <VoteRow
                    tripId={tripId}
                    category={category.id}
                    option={o}
                    myRole={myRole}
                    frozen={frozen}
                  />
                </div>
                <div className="feed__opt-actions">
                  {manageable && o.status !== "LOCKED" && !frozen ? (
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
                    frozen={frozen}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="feed__form-error" role="alert">
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
    </section>
  );
}
