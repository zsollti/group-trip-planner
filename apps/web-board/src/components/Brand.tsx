import { Link } from "react-router-dom";
import { t } from "../lib/i18n";

/**
 * The app's logo, top-left on every page, and always a way home.
 *
 * **The mark is the favicon, grown up.** Three lanes of descending height on a
 * rounded teal tile: the board's own columns, and the ranking the app is
 * actually for. That drawing already existed as `public/favicon.svg` and was the
 * only thing in the product that could be called a logo, so this is not a new
 * identity — it is the one the browser tab has been showing since launch,
 * finally put where a person can see it. A second, unrelated mark would have
 * been the worse outcome: two logos is no logo.
 *
 * **Why the wordmark is DOM text and not part of the SVG.** It inherits the
 * board's own type, tracks the reader's font-size setting, and can be dropped on
 * a narrow screen with one media query while the mark stays. Baking it into the
 * artwork would have made all three of those impossible and gained nothing —
 * the words are not drawn, they are set.
 *
 * **It is always a `Link` to `/`, on every page including `/` itself.** On the
 * inner pages this replaces the `‹ Boards` back-link that used to sit here, and
 * it goes to the same place; the accessible name says so, because a logo that is
 * silently also the back button is only obvious to people who have used the web
 * for twenty years. On the dashboard the link is a no-op, and it stays a link
 * anyway: a logo that is sometimes clickable is a logo people stop trying to
 * click.
 *
 * A separate PNG of the same mark ships for email — see `public/logo-mark.png`
 * and the note in `EmailService` on why an inbox cannot have this SVG.
 */
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label={t("Trip Board — your boards")}>
      <BrandLockup />
    </Link>
  );
}

/**
 * The mark and the wordmark together, with nothing to click.
 *
 * For the signed-out cards — sign in, register, verify, the invite landing —
 * which have no bar to put a logo on and, more to the point, nowhere to go: the
 * only route out of them is the one the card itself offers. They each opened
 * with the word "TRIP BOARD" set as an eyebrow, so this is the same statement
 * with the app's face on it, and the first thing a stranger following an invite
 * link now sees is a product rather than a form.
 */
export function BrandLockup() {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand__word">{t("Trip Board")}</span>
    </span>
  );
}

/**
 * The mark alone, at whatever size its box gives it.
 *
 * `aria-hidden` because it never appears without the wordmark or a labelled
 * link around it — announcing "Trip Board Trip Board" is what an unhidden
 * decorative logo does.
 */
export function BrandMark() {
  return (
    <svg
      className="brand__mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      {/* Hard-coded rather than tokenised, and deliberately: a logo is one
          colour in both themes. The teal is `--board-accent`'s value and the
          bars are `--board-bg`'s, but reading the tokens would let the mark
          invert in dark mode, which is the one thing a mark must not do — it is
          how a reader recognises the app at a glance in a row of tabs. The
          contrast holds on both backgrounds because the tile is solid. */}
      <rect width="32" height="32" rx="7" fill="#0f766e" />
      <rect x="6" y="8" width="5" height="16" rx="2.5" fill="#f5efe3" />
      <rect
        x="13.5"
        y="8"
        width="5"
        height="11"
        rx="2.5"
        fill="#f5efe3"
        opacity=".72"
      />
      <rect
        x="21"
        y="8"
        width="5"
        height="7"
        rx="2.5"
        fill="#f5efe3"
        opacity=".45"
      />
    </svg>
  );
}
