import { useState } from "react";
import { can, type OptionView, type TripRole } from "@gtp/types";
import { ApiError, useToggleVote } from "@gtp/api-client";

/**
 * Board-paradigm dot-voting (Phase 2.3): one dot per approval vote (the viewer's
 * own dot filled), a toggle to add/remove it, and the public voter list with a
 * stale marker on votes cast before the option's last material edit (FR-22/23).
 * The toggle shows only to voters (`vote.cast`); everyone sees the dots. This is
 * the one card control that stays inline — it's the primary action for everyone;
 * edit/delete/lock live in the card's "⋯" menu (Phase 3.5).
 */
export function VoteDots({
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
    <div className="lane__vote">
      <div className="lane__dots" aria-label={`${option.voteCount} votes`}>
        {option.voters.length === 0 ? (
          <span className="lane__meta">no votes</span>
        ) : (
          option.voters.map((v) => (
            <span
              key={v.userId}
              className={"lane__dot" + (v.stale ? " lane__dot--stale" : "")}
              title={v.stale ? `${v.displayName} (stale)` : v.displayName}
            />
          ))
        )}
      </div>
      {can(myRole, "vote.cast") && !frozen ? (
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
