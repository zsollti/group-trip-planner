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
  title,
}: {
  name: string;
  /** Seeds the fallback colour. Falls back to the name when absent. */
  userId?: string;
  url?: string | null;
  size?: number;
  /**
   * Hover text, when the caller has something more to say than the name — the
   * vote stack appends "voted before the last change" to a stale voter.
   *
   * It **replaces** the tooltip rather than adding one, and it applies to the
   * photo as well as the initials. Both matter: two nested nodes carrying the
   * same `title` is duplicate tooltip surface, and until this existed a person
   * who had uploaded a picture had no hover name at all — only the generated
   * fallback did.
   */
  title?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size / 2.4) };

  if (url) {
    return (
      <img
        className="avatar avatar--image"
        style={style}
        src={url}
        title={title ?? name}
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
      title={title ?? name}
    >
      {initialsOf(name)}
    </span>
  );
}
