/**
 * The shape every outgoing email is poured into.
 *
 * The four templates this service sends were each a `<p>` and an `<a>`, with no
 * markup around them at all. That renders as a bare blue link on a white sheet —
 * which is exactly what a phishing mail looks like, and the one message where it
 * matters most is the verification link, the very first thing a new account
 * receives. So this is not decoration: an email that looks like it came from the
 * product is part of the product's claim to be the sender.
 *
 * ## Only markup lives here. No prose.
 *
 * Every sentence stays in `email.service.ts`, and that is load-bearing rather
 * than tidy: `i18n.spec.ts` reads that one file and asserts every entry in
 * `EMAIL_MESSAGES` still appears in it, so prose that migrated in here would
 * read to the test as an email string nothing says any more. The division is
 * also the one the i18n note asks for — translators see sentences, never tags.
 *
 * ## Why it is written like it is 1999
 *
 * Tables, inline styles, `width` attributes, no `<style>` block and no classes.
 * Every one of those is a concession to mail clients rather than a preference:
 * Outlook's Word-based renderer ignores `float`, `flex` and most of the box
 * model, and Gmail strips `<head>`, taking any stylesheet with it. The layout
 * that survives all of them is a centred table with inline styles on every cell,
 * which is what this builds.
 *
 * SVG is out for the same reason — Gmail drops it entirely — so the mark ships
 * as a PNG the web app serves (`public/logo-mark.png`), referenced absolutely.
 * A `cid:` attachment would render offline but makes every send carry an
 * attachment; a linked image degrades to its `alt` text, and the wordmark beside
 * it means the header still says who this is with images off.
 *
 * ## Colours are literals, and dark mode is not attempted
 *
 * The palette is the board's own token contract copied by value (sand, teal,
 * paper). It has to be by value — there is no stylesheet to read tokens from —
 * and a note here is a better answer than a CSS variable that silently resolves
 * to nothing in an inbox. Clients that force their own dark mode will invert
 * some of it; every one of them does that differently, and chasing it costs more
 * than it returns for four transactional messages.
 */

/** The board's palette, copied by value. See the note above on why. */
const SAND = "#f5efe3";
const PAPER = "#fffdf8";
const LINE = "#e7ddc9";
const INK = "#232826";
const DIM = "#6f736b";
const TEAL = "#0f766e";
const ON_TEAL = "#ffffff";

/**
 * The name in the header.
 *
 * Deliberately **not** translated, unlike the same words on screen. A mail
 * client shows a list of senders, and a reader picks the one they recognise out
 * of it — an identity that changes wording with the recipient's language is one
 * they have to learn twice. The prose underneath is translated; the signature is
 * not, for the same reason `EMAIL_FROM` is not.
 */
const PRODUCT = "Group Trip Planner";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailLayoutInput {
  /** Where the web app lives, for the logo image. */
  readonly webAppUrl: string;
  /** The message itself: paragraphs, blockquotes, whatever the template built. */
  readonly body: string;
  /** The one action, rendered as a real button. Optional — not every mail has one. */
  readonly action?: { readonly label: string; readonly href: string };
  /** Small print under the card. Already-escaped HTML; optional. */
  readonly footer?: string;
}

/**
 * A `<p>` in the body's own type.
 *
 * Exported so templates keep saying `p(t("…"))` rather than carrying a style
 * attribute apiece — which is how one paragraph in one email ends up a different
 * size from the rest and nobody can say when it happened.
 */
export function p(html: string): string {
  return `<p style="margin:0 0 14px;color:${INK};font-size:15px;line-height:1.55">${html}</p>`;
}

/** A quoted excerpt — currently just the mention email's message snippet. */
export function quote(html: string): string {
  return (
    `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid ${TEAL};` +
    `background:${SAND};color:${INK};font-size:15px;line-height:1.5">${html}</blockquote>`
  );
}

/** The small print: the unsubscribe line, and anything else that is not the message. */
export function fine(html: string): string {
  return `<p style="margin:0 0 6px;color:${DIM};font-size:12px;line-height:1.5">${html}</p>`;
}

/**
 * The whole email.
 *
 * Returns a fragment rather than a full `<html>` document on purpose: Resend
 * wraps what it is given, and a nested `<html>` is the kind of thing that makes
 * a client fall back to its own defaults for the entire message.
 */
export function renderEmail(input: EmailLayoutInput): string {
  const logo = `${input.webAppUrl.replace(/\/+$/, "")}/logo-mark.png`;

  // The call to action, as a table rather than a padded `<a>`: Outlook ignores
  // padding on an inline element, which collapses a button into a bare link
  // exactly where the recipient most needs something obvious to press.
  const action = input.action
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:6px 0 4px">` +
      `<tr><td align="center" bgcolor="${TEAL}" style="border-radius:10px">` +
      `<a href="${input.action.href}" style="display:inline-block;padding:11px 22px;` +
      `font-family:${FONT};font-size:15px;font-weight:600;color:${ON_TEAL};text-decoration:none">` +
      `${input.action.label}</a></td></tr></table>`
    : "";

  const footer = input.footer
    ? `<tr><td style="padding:14px 4px 0">${input.footer}</td></tr>`
    : "";

  return (
    `<div style="margin:0;padding:24px 12px;background:${SAND};font-family:${FONT}">` +
    `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">` +
    `<tr><td align="center">` +
    // 520px: a comfortable measure that still fits the narrowest reading pane.
    `<table role="presentation" width="520" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px">` +
    // The mark and the name. `alt` empty and the name in text beside it, so the
    // header reads correctly with images blocked — which is the default in a lot
    // of clients for a sender nobody has written to before.
    `<tr><td style="padding:0 4px 14px">` +
    `<img src="${logo}" width="34" height="34" alt="" style="vertical-align:middle;border-radius:8px;display:inline-block">` +
    `<span style="vertical-align:middle;padding-left:10px;font-size:16px;font-weight:700;color:${INK};letter-spacing:-0.01em">${PRODUCT}</span>` +
    `</td></tr>` +
    `<tr><td style="background:${PAPER};border:1px solid ${LINE};border-radius:14px;padding:24px">` +
    `${input.body}${action}` +
    `</td></tr>` +
    footer +
    `</table></td></tr></table></div>`
  );
}
