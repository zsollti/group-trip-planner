import { useState } from "react";
import {
  can,
  type OptionParticipantView,
  type OptionView,
  type OptionVoterView,
  type TripRole,
} from "@gtp/types";
import {
  ApiError,
  useToggleParticipation,
  useToggleVote,
} from "@gtp/api-client";
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

/**
 * Everyone who is in, as a list you can actually read — the participants'
 * counterpart to {@link VoterList}, and for the same reason: three faces on a
 * card answer "roughly who", and past that only a full list is honest.
 */
function ParticipantList({
  participants,
  onClose,
}: {
  participants: OptionParticipantView[];
  onClose: () => void;
}) {
  return (
    <Dialog
      eyebrow="Who's in"
      title={`${participants.length} in`}
      onClose={onClose}
    >
      <>
        <ul className="voters">
          {participants.map((p) => (
            <li key={p.userId} className="voters__item">
              <Avatar
                name={p.displayName}
                userId={p.userId}
                url={p.avatarUrl}
                size={28}
              />
              <span className="voters__name">{p.displayName}</span>
            </li>
          ))}
        </ul>
        <div className="board__dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </>
    </Dialog>
  );
}

/**
 * Who is in for an opt-in option, and a toggle to be one of them.
 *
 * Deliberately built as {@link VoteDots}'s twin — same faces, same overflow
 * count, same inline placement — because the two are the same *kind* of
 * statement from a member about an option, and giving them different shapes
 * would make the board look like it had two unrelated ideas.
 *
 * They mean different things, though, and the labels carry that: a vote says
 * *we should do this*, being in says *I will pay for this*. Only an `OPT_IN`
 * option draws this at all, so the overwhelming majority of cards keep exactly
 * one toggle and nobody has to learn the difference to use the board.
 */
export function ParticipantDots({
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
  const toggle = useToggleParticipation(tripId, category);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);

  if (option.participationMode !== "OPT_IN") return null;

  const shown = option.participants.slice(0, SHOWN);
  const overflow = option.participants.length - shown.length;

  async function onToggle() {
    setError(null);
    try {
      await toggle.mutateAsync({
        optionId: option.id,
        isParticipant: option.viewerIsParticipant,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change that");
    }
  }

  return (
    <div className="lane__vote lane__in">
      {/* The faces here and the voters' faces above are often the *same people*
          in a different meaning, and a row of avatars cannot say which it is.
          The button text distinguishes them once you read it; this says so
          before you do. */}
      <span className="lane__in-label" aria-hidden="true">
        in
      </span>
      {option.participants.length === 0 ? (
        // Not "no participants": the point of the card is to ask, so the empty
        // state is the question rather than a report of nothing.
        <span className="lane__meta">nobody yet</span>
      ) : (
        <button
          type="button"
          className="lane__voters"
          aria-label={`${option.participants.length} in — see who`}
          onClick={() => setListing(true)}
        >
          {shown.map((p) => (
            <span key={p.userId} className="lane__voter">
              <Avatar
                name={p.displayName}
                userId={p.userId}
                url={p.avatarUrl}
                size={22}
                title={p.displayName}
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
            "lane__vote-btn lane__in-btn" +
            (option.viewerIsParticipant ? " lane__vote-btn--on" : "")
          }
          aria-pressed={option.viewerIsParticipant}
          disabled={toggle.isPending}
          onClick={onToggle}
        >
          {option.viewerIsParticipant ? "✓ I'm in" : "+ I'm in"}
        </button>
      ) : null}
      {error ? (
        <span className="board__form-error" role="alert">
          {error}
        </span>
      ) : null}
      {listing ? (
        <ParticipantList
          participants={option.participants}
          onClose={() => setListing(false)}
        />
      ) : null}
    </div>
  );
}
