import type { CSSProperties } from "react";
import { avatarPresetOf, isAvatarPresetUrl } from "@gtp/types";
import { avatarHue, initialsOf } from "../lib/avatar";
import { AvatarPresetMark } from "./AvatarPresetMark";

/**
 * A person, shown as their picture, one of the drawn marks, or — when they have
 * set neither — generated initials on a colour derived from their id (Phase
 * 6.2). The fallback logic lives in `lib/avatar` so it can be tested without
 * rendering.
 *
 * The three cases share one `url` prop, because they share one stored column:
 * a drawn mark is an `avatarUrl` of `"preset:tent"` (see the contract's
 * `avatar.ts` for why there is no second field). Recognising it is
 * `avatarPresetOf`'s job and nothing here tests the string itself — an unknown
 * key falls back to initials rather than to an empty circle, which is what
 * makes the list of marks safe to change.
 *
 * A mark takes the **same generated hue** as the initials it replaces, so one
 * person keeps one colour whichever they are wearing.
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
  // Read before the image branch, not after it: `avatarUrl` carries both, and
  // an `<img src="preset:tent">` is a broken image, not a fallback.
  //
  // Two questions, deliberately: *is* this a mark, and *which* mark. A key this
  // build does not know — an older or newer one — answers yes then null, and
  // has to fall through to the initials rather than to an `<img>`.
  const preset = avatarPresetOf(url);

  if (url && !isAvatarPresetUrl(url)) {
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

  const tinted = {
    ...style,
    "--avatar-hue": avatarHue(userId ?? name),
  } as CSSProperties;

  if (preset) {
    return (
      <span
        className="avatar avatar--initials avatar--preset"
        style={tinted}
        aria-hidden="true"
        title={title ?? name}
      >
        <AvatarPresetMark preset={preset} size={size} />
      </span>
    );
  }

  return (
    <span
      className="avatar avatar--initials"
      style={tinted}
      aria-hidden="true"
      title={title ?? name}
    >
      {initialsOf(name)}
    </span>
  );
}
