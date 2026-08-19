import { useState } from "react";
import type { OptionParticipantView } from "@gtp/types";
import { AnswerPanel } from "./AnswerPanel";
import { Avatar } from "./Avatar";
import { t } from "../lib/i18n";

/** Faces before the count takes over. Three fits a 15rem lane column. */
const SHOWN = 3;

/**
 * Everyone who is in, and everyone still to say — the counterpart to the stack,
 * and its reason for existing: three faces answer "roughly who", and past that
 * only a full list is honest.
 *
 * The same {@link AnswerPanel} the votes stack opens, for the same reason: an
 * opt-in option is priced for whoever is in, so "four in" means one thing next
 * to a crew of four and quite another next to a crew of ten.
 */
function ParticipantList({
  tripId,
  participants,
  onClose,
}: {
  tripId: string;
  participants: readonly OptionParticipantView[];
  onClose: () => void;
}) {
  return (
    <AnswerPanel
      tripId={tripId}
      answered={participants.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      }))}
      title={(n, total) =>
        total === null
          ? t("{n} in", { n })
          : t("{n} / {total} in", { n, total })
      }
      pendingLabel={t("Not in yet")}
      doneLabel={t("Everyone is in.")}
      notAskedLabel={t("Guests — not asked to join")}
      onClose={onClose}
    />
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
  tripId,
  people,
  mine,
  label,
}: {
  /** The trip, so the panel behind the stack can count who has not answered. */
  tripId: string;
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
          tripId={tripId}
          participants={people}
          onClose={() => setListing(false)}
        />
      ) : null}
    </>
  );
}
