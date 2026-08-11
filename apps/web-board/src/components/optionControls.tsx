import { useState } from "react";
import {
  can,
  type OptionView,
  type OptionVoterView,
  type TripRole,
} from "@gtp/types";
import { ApiError, useToggleVote } from "@gtp/api-client";
import { Button } from "@gtp/ui-primitives";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";

/** How many faces fit on a card before the rest become a count. */
const SHOWN = 3;

/**
 * Everyone who voted, as a list you can actually read.
 *
 * The stack on the card answers "roughly who, and how many"; past three faces
 * that is all it can honestly do in a 15rem column. This answers "exactly
 * who" — full names, unabbreviated, with the stale votes called out in words
 * rather than by a visual treatment nobody has a legend for.
 */
function VoterList({
  voters,
  onClose,
}: {
  voters: OptionVoterView[];
  onClose: () => void;
}) {
  return (
    <Dialog eyebrow="Votes" title={`${voters.length} voted`} onClose={onClose}>
      <>
        <ul className="voters">
          {voters.map((v) => (
            <li key={v.userId} className="voters__item">
              <Avatar
                name={v.displayName}
                userId={v.userId}
                url={v.avatarUrl}
                size={28}
              />
              <span className="voters__name">{v.displayName}</span>
              {v.stale ? (
                <span className="voters__stale">
                  voted before the last change
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {/* `Dialog` binds Escape and nothing else — every caller brings its own
            close control, and a dialog a mouse cannot dismiss is a trap. */}
        <div className="board__dialog-actions">
          <Button type="button" variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    </Dialog>
  );
}

/**
 * Board-paradigm approval voting (Phase 2.3): the people who voted, a toggle to
 * add or remove yourself, and the stale marker on votes cast before the option's
 * last material edit (FR-22/23). The toggle shows only to voters (`vote.cast`);
 * everyone sees who voted. This is the one card control that stays inline — it
 * is the primary action for everyone, while edit/delete/lock live in the card's
 * "⋯" menu (Phase 3.5).
 *
 * **Faces, not dots.** A row of identical dots could be counted and nothing
 * else; on a board where the question is usually "has everyone weighed in yet",
 * the useful answer is *who*, and the app already knows what each person looks
 * like. Three fit in a lane, so the rest become a "+n" that opens the full list
 * rather than a stack that shrinks until it is dots again.
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
  const [listing, setListing] = useState(false);

  const shown = option.voters.slice(0, SHOWN);
  const overflow = option.voters.length - shown.length;

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
      {option.voters.length === 0 ? (
        <span className="lane__meta">no votes</span>
      ) : (
        // One accessible name for the whole stack: read face by face it would
        // announce three names and then a number, which is not what it means.
        <button
          type="button"
          className="lane__voters"
          aria-label={`${option.voteCount} ${option.voteCount === 1 ? "vote" : "votes"} — see who`}
          onClick={() => setListing(true)}
        >
          {shown.map((v) => (
            <span
              key={v.userId}
              className={"lane__voter" + (v.stale ? " lane__voter--stale" : "")}
            >
              <Avatar
                name={v.displayName}
                userId={v.userId}
                url={v.avatarUrl}
                size={22}
                title={
                  v.stale
                    ? `${v.displayName} — voted before the last change`
                    : v.displayName
                }
              />
            </span>
          ))}
          {overflow > 0 ? (
            <span className="lane__voter-more">+{overflow}</span>
          ) : null}
        </button>
      )}
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
      {listing ? (
        <VoterList voters={option.voters} onClose={() => setListing(false)} />
      ) : null}
    </div>
  );
}
