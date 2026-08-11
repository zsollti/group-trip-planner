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
