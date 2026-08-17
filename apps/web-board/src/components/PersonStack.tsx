import { useState } from "react";
import { Button } from "@gtp/ui-primitives";
import type { OptionParticipantView } from "@gtp/types";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { t } from "../lib/i18n";

/** Faces before the count takes over. Three fits a 15rem lane column. */
const SHOWN = 3;

/**
 * Everyone who is in, as a list you can actually read — the counterpart to the
 * stack, and its reason for existing: three faces answer "roughly who", and past
 * that only a full list is honest.
 */
function ParticipantList({
  participants,
  onClose,
}: {
  participants: readonly OptionParticipantView[];
  onClose: () => void;
}) {
  return (
    <Dialog
      eyebrow="Who's in"
      title={t("{n} in", { n: participants.length })}
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
            {t("Close")}
          </Button>
        </div>
      </>
    </Dialog>
  );
}

/**
 * The people an opt-in option is priced for, drawn as faces: up to three, then
 * a `+N`, opening the full list when clicked.
 *
 * Lifted out of the option card's own controls because the cost surface needed
 * exactly the same thing. It used to say "for 4 members" there — the count
 * answering a question nobody standing in front of that panel is asking. What a
 * reader wants to know about an option priced for part of the group is *who*,
 * and specifically whether that includes them; a number cannot say either, and
 * the board already draws people as faces everywhere else it names them.
 *
 * `mine` rings the reader's own face. It replaces a "· yours" that used to
 * follow the sentence, and it says the same thing in the place the eye is
 * already looking rather than in a clause after it.
 */
export function PersonStack({
  people,
  mine,
  label,
}: {
  people: readonly OptionParticipantView[];
  /** The reader's own id, so their face can be marked. Undefined marks none. */
  mine?: string;
  /** The accessible name for the whole stack — it is one control. */
  label: string;
}) {
  const [listing, setListing] = useState(false);
  if (people.length === 0) return null;

  const shown = people.slice(0, SHOWN);
  const overflow = people.length - shown.length;

  return (
    <>
      <button
        type="button"
        className="lane__voters"
        aria-label={label}
        onClick={() => setListing(true)}
      >
        {shown.map((p) => (
          <span
            key={p.userId}
            className={
              "lane__voter" + (p.userId === mine ? " lane__voter--mine" : "")
            }
          >
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
      {listing ? (
        <ParticipantList
          participants={people}
          onClose={() => setListing(false)}
        />
      ) : null}
    </>
  );
}
