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
