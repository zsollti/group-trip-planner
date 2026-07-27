/**
 * The generated half of an avatar (Phase 6.2): what to draw for someone who
 * hasn't uploaded a picture.
 *
 * Generated rather than a stock silhouette because a wall of identical grey
 * heads tells you nothing — in a crew list or a chat thread the mark exists to
 * tell people apart at a glance, and initials on a stable colour do that with
 * no photo in sight. Pure, so both are unit-testable without rendering.
 */

/** Up to two initials from a display name; "?" when there is nothing to take. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  // Index by code point, so an emoji or an accented letter isn't cut in half.
  const first = [...parts[0]!][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A hue from a seed (the user id). Deterministic, so one person keeps the same
 * colour across sessions, devices and surfaces — which is the entire point of a
 * generated mark. Saturation and lightness are fixed in CSS so every hue stays
 * legible against white text.
 */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}
