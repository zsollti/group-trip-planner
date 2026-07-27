import type { CSSProperties } from "react";
import { avatarHue, initialsOf } from "../lib/avatar";

/**
 * A person, shown as their picture or — when they haven't set one — generated
 * initials on a colour derived from their id (Phase 6.2). The fallback logic
 * lives in `lib/avatar` so it can be tested without rendering.
 */
export function Avatar({
  name,
  userId,
  url,
  size = 32,
}: {
  name: string;
  /** Seeds the fallback colour. Falls back to the name when absent. */
  userId?: string;
  url?: string | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size / 2.4) };

  if (url) {
    return (
      <img
        className="avatar avatar--image"
        style={style}
        src={url}
        // The name is rendered beside the avatar everywhere it appears, so
        // announcing it again would only add noise for a screen reader.
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      className="avatar avatar--initials"
      style={
        { ...style, "--avatar-hue": avatarHue(userId ?? name) } as CSSProperties
      }
      aria-hidden="true"
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}
