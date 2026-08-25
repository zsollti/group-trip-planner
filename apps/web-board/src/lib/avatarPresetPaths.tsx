import type { ReactNode } from "react";
import type { AvatarPreset } from "@gtp/types";

/**
 * The drawings themselves, split from their names for one dull reason: a
 * `.tsx` module that exports values beside JSX loses fast refresh, and the
 * names are wanted by a picker that never draws anything.
 *
 * One stroke weight, one 24-unit grid, `currentColor` throughout, so a mark
 * sits on the same generated hue the initials do.
 */
/** The paths of one mark, on a 24-unit grid. */
export const PRESET_PATHS: Record<AvatarPreset, ReactNode> = {
  tent: (
    <>
      <path d="M12 4 3 20h18L12 4Z" />
      <path d="M12 4v16M12 20l4-7M12 20l-4-7" />
    </>
  ),
  backpack: (
    <>
      <rect x="5" y="7" width="14" height="14" rx="4" />
      <path d="M9 7V5.5A3 3 0 0 1 15 5.5V7" />
      <path d="M9 14h6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  map: (
    <>
      <path d="m3 6.5 6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5v-13Z" />
      <path d="M9 4v13M15 7v13" />
    </>
  ),
  plane: (
    <>
      <path d="M2.5 13.5 21 5l-4 9.5-3.5.5-2.5 5-1.5-4-4-1 -3-1.5Z" />
      <path d="m10.5 15 3-3" />
    </>
  ),
  passport: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M9 16h6" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="7" width="19" height="13" rx="2.5" />
      <path d="M9 7l1.5-3h3L15 7" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  mountain: (
    <>
      <path d="M2.5 19 9 8l4 6 2.5-3.5L21.5 19h-19Z" />
      <path d="m7 12.5 2 1.5" />
    </>
  ),
  palm: (
    <>
      <path d="M12 9v12" />
      <path d="M12 9c-3.5-3-7-2.5-8.5 0M12 9c3.5-3 7-2.5 8.5 0M12 9c-1.5-4 1.5-6 4-5.5M12 9c1-4-2-6-4.5-5" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 7.5V21" />
      <path d="M4 13c0 4.5 3.5 8 8 8s8-3.5 8-8" />
      <path d="M8 11h8" />
    </>
  ),
  campfire: (
    <>
      <path d="M12 4c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0C8 9 9.5 7 12 4Z" />
      <path d="m4 20 16-4M20 20 4 16" />
    </>
  ),
  suitcase: (
    <>
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2" />
      <path d="M3 13h18" />
    </>
  ),
};
