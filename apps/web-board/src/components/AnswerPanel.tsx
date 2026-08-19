import { can } from "@gtp/types";
import { useTripMembers } from "@gtp/api-client";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";

/**
 * Who has answered, and who has not — the panel behind a stack of faces.
 *
 * The two stacks on a card ask the same shape of question of the same people: a
 * vote says *we should do this*, being in says *I will pay for this*. Both used
 * to open a bare list of whoever had answered under a count of them, and a count
 * with no denominator cannot answer the question anyone actually opens this for.
 * "Three voted" is a fact; "three of five voted" is a decision — the first says
 * nothing about whether the group is still waiting on someone.
 *
 * So the panel is the roster, split in two. Everyone who may answer is counted,
 * the ones who have are listed, and the ones who have not are listed after them
 * — because "who are we waiting for" is the next question every time, and the
 * board already knows.
 *
 * **Who may answer is a permission, not a headcount.** A Guest can read a board
 * and talk on it but cannot vote (`vote.cast`), so counting them would make a
 * fully-decided option read as perpetually short of a few answers.
 *
 * The roster is fetched when the panel opens rather than passed in: the card
 * carries the people who *answered*, which is the half a lane needs, and the
 * other half is a question only the trip can answer.
 */

/** One person who has answered, as the card already knows them. */
export interface Answerer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** A caveat printed beside the name — a vote cast before the last edit. */
  note?: string | null;
}

export function AnswerPanel({
  tripId,
  answered,
  title,
  pendingLabel,
  doneLabel,
  onClose,
}: {
  tripId: string;
  answered: readonly Answerer[];
  /**
   * The heading, given both figures.
   *
   * A function rather than a string because the panel decides the denominator
   * and the caller owns the wording — "voted" and "in" are different sentences,
   * and a sentence assembled here out of fragments would put the words in the
   * wrong order in the next language. `total` is null until the roster lands,
   * which is the caller's cue to say the half it already knows.
   */
  title: (answeredCount: number, total: number | null) => string;
  /** What the second group is called: "Yet to vote", "Not in yet". */
  pendingLabel: string;
  /** …and what stands in its place when there is nobody left to wait for. */
  doneLabel: string;
  onClose: () => void;
}) {
  const members = useTripMembers(tripId);
  // Everyone whose answer this panel is counting — a permission, not a
  // headcount; see the note above.
  const eligible = (members.data?.members ?? []).filter((m) =>
    can(m.role, "vote.cast"),
  );
  const answeredIds = new Set(answered.map((a) => a.userId));
  const pending = eligible.filter((m) => !answeredIds.has(m.userId));
  // Null while the roster is still in flight: a denominator of zero would read
  // as "0 of 0", which is a worse answer than not saying yet.
  const total = members.data ? eligible.length : null;
  const share = total && total > 0 ? answered.length / total : 0;

  return (
    <Dialog title={title(answered.length, total)} onClose={onClose}>
      <div className="answers">
        {/* Decoration: the heading above it states both figures, and this is
            the same fraction as a length. It is what makes the panel readable
            at a glance rather than by arithmetic — the reason to redraw it at
            all — so it is quiet, and it is `aria-hidden`. */}
        {total !== null ? (
          <div className="answers__meter" aria-hidden="true">
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        ) : null}

        <ul className="voters">
          {answered.map((person) => (
            <li key={person.userId} className="voters__item">
              <Avatar
                name={person.displayName}
                userId={person.userId}
                url={person.avatarUrl}
                size={28}
              />
              <span className="voters__name">{person.displayName}</span>
              {person.note ? (
                <span className="voters__stale">{person.note}</span>
              ) : null}
            </li>
          ))}
        </ul>

        {total === null ? null : pending.length > 0 ? (
          <div className="answers__pending">
            <p className="board__eyebrow">{pendingLabel}</p>
            <ul className="voters">
              {pending.map((m) => (
                <li key={m.userId} className="voters__item">
                  {/* Dimmed as a set rather than each face being greyed: these
                      are the same people at full strength one list up whenever
                      they answer, and a person is not a different person for
                      not having got to it yet. */}
                  <Avatar
                    name={m.displayName}
                    userId={m.userId}
                    url={m.avatarUrl}
                    size={28}
                  />
                  <span className="voters__name">{m.displayName}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="answers__done">{doneLabel}</p>
        )}
      </div>
    </Dialog>
  );
}
