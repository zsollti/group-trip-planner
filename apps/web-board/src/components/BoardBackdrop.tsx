/**
 * Phase 3.5 theme: a subtle, decorative "trip" backdrop — a handful of scattered
 * travel line-icons (tent, mountain, compass, snowboard…) drawn very faintly
 * behind every page. Purely cosmetic: it is `aria-hidden`, non-interactive
 * (`pointer-events: none` via CSS), and sits on its own layer beneath the content,
 * so it never affects layout, focus order, or screen readers. Mounted once at the
 * app root. The final theme (a later conversation) may replace the motif set.
 */
import type { CSSProperties } from "react";

const STROKE = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 24×24 line glyphs — deliberately simple so they read at low opacity. */
const ICONS = {
  mountain: (
    <path {...STROKE} d="M2 20 L9 7 L14 15 L17 10 L22 20 Z M9 7 L11 11" />
  ),
  tent: (
    <>
      <path {...STROKE} d="M3 20 L12 5 L21 20" />
      <path {...STROKE} d="M12 5 L12 20 M9 20 L12 14 L15 20" />
    </>
  ),
  compass: (
    <>
      <circle {...STROKE} cx="12" cy="12" r="9" />
      <path {...STROKE} d="M15.5 8.5 L11 11 L8.5 15.5 L13 13 Z" />
    </>
  ),
  plane: (
    <>
      <path {...STROKE} d="M21 3 L3 10.5 L10 13.5 L13 20.5 Z" />
      <path {...STROKE} d="M21 3 L10 13.5" />
    </>
  ),
  sun: (
    <>
      <circle {...STROKE} cx="12" cy="12" r="4" />
      <path
        {...STROKE}
        d="M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M5 5 L6.4 6.4 M17.6 17.6 L19 19 M19 5 L17.6 6.4 M6.4 17.6 L5 19"
      />
    </>
  ),
  snowboard: (
    <>
      <rect {...STROKE} x="9.5" y="2.5" width="5" height="19" rx="2.5" />
      <path {...STROKE} d="M9.5 9 H14.5 M9.5 14 H14.5" />
    </>
  ),
  backpack: (
    <>
      <rect {...STROKE} x="6" y="7" width="12" height="14" rx="3.5" />
      <path {...STROKE} d="M9 7 V5.5 A3 3 0 0 1 15 5.5 V7 M9 13 H15" />
    </>
  ),
};

/** Where each glyph sits (scattered, gently rotated) — CSS pins it via `--r`. */
const PLACEMENTS: {
  icon: keyof typeof ICONS;
  style: CSSProperties;
}[] = [
  {
    icon: "mountain",
    style: { top: "8%", left: "6%", "--r": "-8deg" } as CSSProperties,
  },
  {
    icon: "plane",
    style: { top: "14%", right: "9%", "--r": "12deg" } as CSSProperties,
  },
  {
    icon: "compass",
    style: { top: "44%", left: "3%", "--r": "6deg" } as CSSProperties,
  },
  {
    icon: "sun",
    style: { top: "62%", right: "5%", "--r": "0deg" } as CSSProperties,
  },
  {
    icon: "tent",
    style: { bottom: "8%", left: "12%", "--r": "-5deg" } as CSSProperties,
  },
  {
    icon: "snowboard",
    style: { bottom: "14%", right: "16%", "--r": "18deg" } as CSSProperties,
  },
  {
    icon: "backpack",
    style: { top: "34%", right: "30%", "--r": "-12deg" } as CSSProperties,
  },
];

export function BoardBackdrop() {
  return (
    <div className="board__decor" aria-hidden="true">
      {PLACEMENTS.map(({ icon, style }, i) => (
        <svg key={i} viewBox="0 0 24 24" style={style}>
          {ICONS[icon]}
        </svg>
      ))}
    </div>
  );
}
