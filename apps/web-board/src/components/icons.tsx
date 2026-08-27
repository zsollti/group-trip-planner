import type { ReactNode } from "react";

/**
 * The board's drawn glyphs.
 *
 * One wrapper so every icon in the app is the same weight, cap and join — a
 * 1.8px stroke on a 24px grid, taking its colour from `currentColor`. Drawn
 * rather than typed for the reason {@link CategoryIcon} gives: an emoji is
 * rendered by the reader's OS, so the same card is a flat glyph on Windows, a
 * glossy pictogram on iOS and a tofu box where the font is missing.
 *
 * Always `aria-hidden`. Each of these sits directly beside the value it marks,
 * so announcing it would only add noise — a screen reader should hear "620 EUR
 * per person", not "money, 620 EUR per person".
 */
export function Glyph({
  children,
  size = 14,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={["glyph", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Marks a date or a range on a card. */
export function CalendarIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Glyph>
  );
}

/**
 * The crew panel's per-person actions, as marks.
 *
 * Six controls on a strip you scan past cannot be six words — the row would
 * stop being a list of people and become a toolbar. Every one carries its own
 * name on `title` and `aria-label`, which is where the word goes: these are
 * buttons, not labels for a value beside them, so unlike the rest of this file
 * they are announced.
 *
 * Chosen so the three roles read as *what that person does* rather than as a
 * rank: a key unlocks decisions, a pin plans a trip, an eye only watches.
 */

/** Organizer: the one who can lock a decision. */
export function KeyIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12.5 20 3.5M17.5 6l2.5 2.5M15 8.5l2.5 2.5" />
    </Glyph>
  );
}

/** Traveler: proposes and votes — the ordinary member of a trip. */
export function PinIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Glyph>
  );
}

/** Guest: reads the board and nothing else. */
export function EyeIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </Glyph>
  );
}

/** Hand the trip over. A crown, because ownership is held rather than done. */
export function CrownIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M3 7.5 7 12l5-6.5 5 6.5 4-4.5-1.5 11h-15Z" />
      <path d="M4.5 20h15" />
    </Glyph>
  );
}

/** Remove from the trip. An open door, not a cross: they can be invited back. */
export function ExitIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M11 12h9M16.5 8l4 4-4 4" />
    </Glyph>
  );
}

/** Remove **and** bar from rejoining. The universal "no", which is the one
 *  glyph a reader will not mistake for the door beside it. */
export function BanIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </Glyph>
  );
}

/**
 * Marks a decision, on the card's own title line.
 *
 * The board says "settled" with intensity — a fuller wash and a solid left edge
 * — which is quick to scan and says nothing at all to a reader who cannot see
 * it, or who reads the lane one card at a time. This is the same fact in a
 * second channel, and it is the one channel a screen reader can reach: the card
 * labels it (see `OptionCard`), so unlike every other glyph here it is not
 * announced as decoration.
 */
export function LockIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </Glyph>
  );
}

/** Marks a price. A banknote reads as money at 14px where a currency symbol
 *  would just be another character in a line that already has one. */
export function MoneyIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </Glyph>
  );
}

/** Marks an outbound link — the classic two chain links, at 14px. */
export function LinkIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
    </Glyph>
  );
}

/** Marks a link the whole web can follow — the globe every share sheet uses,
 *  so it needs no learning beside the word "Global". */
export function GlobeIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z" />
    </Glyph>
  );
}

/** Marks a headcount — two figures, so it reads as "people" and not "person". */
export function PeopleIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.2M17.5 14.4a5.5 5.5 0 0 1 3 4.6" />
    </Glyph>
  );
}

/**
 * One person, for the column of things only its owner can see.
 *
 * The same figure {@link PeopleIcon} draws twice over, with the second person
 * left off — the pair reads as "the trip" and "just me" precisely because it is
 * one drawing with a body removed, rather than two unrelated marks.
 */
export function PersonIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
    </Glyph>
  );
}

/**
 * Email for this trip, on or off.
 *
 * Drawn rather than typed because the emoji this replaces had no grey in it:
 * 🔔 and 🔕 are yellow by definition on every platform that ships them, so a
 * menu of otherwise plain text carried one gold pictogram, and the muted state
 * was a *second* gold one. These take `currentColor` like the rest of the set,
 * which means they are the same grey as the words beside them and go dim with
 * a disabled row.
 *
 * The muted one is the same bell with a stroke through it: the pair has to read
 * as one thing in two states, and two different drawings would read as two
 * different subjects.
 */
export function BellIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M18 9a6 6 0 0 0-12 0c0 4-1.5 5.5-2 6.5h16c-.5-1-2-2.5-2-6.5" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Glyph>
  );
}

/** The bell above, silenced. See {@link BellIcon}. */
export function BellOffIcon({ size }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M18 9a6 6 0 0 0-12 0c0 4-1.5 5.5-2 6.5h16c-.5-1-2-2.5-2-6.5" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <path d="M4 4l16 16" />
    </Glyph>
  );
}
