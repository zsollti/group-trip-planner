import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { DEFAULT_LOCALE, type Locale } from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { interpolate, translate } from "../i18n/messages.js";
import { fine, p, quote, renderEmail } from "./layout.js";

/**
 * Outbound email. Two channels live here, and the split is the point (FR-36):
 *
 * - **Transactional** — verification, "account already exists", personal invites.
 *   Sent inline, synchronously, and **never consulted against a preference**: an
 *   unsubscribe must not be able to cost someone their account-recovery mail.
 * - **Notification** — {@link sendMentionEmail}, the only preference-gated one.
 *   It is never called directly by a request path; the queue worker calls it,
 *   and gating already happened at enqueue time (Phase 5.2).
 *
 * In dev / without a Resend key, messages are logged so links are visible in the
 * console. When RESEND_API_KEY is set (staging/prod) the same calls send real
 * email.
 *
 * **Every method takes the recipient's language**, because there is no client in
 * an inbox: nothing downstream of here can choose it later. It defaults to the
 * source language so a caller that genuinely has nobody to ask — the
 * account-exists notice goes to an address, not necessarily to an account — is
 * not forced to invent an answer.
 *
 * Prose is translated; **markup is not**. The sentences go through the catalogue
 * and the HTML is assembled here, so a translator never sees a tag and cannot
 * break a link. User-supplied values (a trip name, a message excerpt) are still
 * escaped on the way in, exactly as before.
 *
 * **The markup itself lives in `layout.ts`** — the header with the app's mark,
 * the card, the button — and every template here is now a heading, some
 * paragraphs and at most one action. What stays in this file is the prose, and
 * that is deliberate as well as tidy: `i18n.spec.ts` reads *this file* to check
 * that every entry in `EMAIL_MESSAGES` is still said somewhere, so a sentence
 * that moved into the layout would read as an orphaned translation.
 *
 * Each sentence is translated **whole**, with `{placeholders}` for the values it
 * contains — never assembled from fragments. `t("You're invited to") + name`
 * would read correctly in English and wrongly in a language that puts the verb,
 * the quote or the possessive somewhere else; a translator handed the whole
 * sentence can move the placeholder to where their language needs it.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  }

  async sendVerificationEmail(
    to: string,
    rawToken: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const t = (message: string) => translate(message, locale);
    const link = `${this.env.WEB_APP_URL}/verify?token=${encodeURIComponent(rawToken)}`;
    const subject = t("Verify your email");
    /*
     * Three short paragraphs where there was one clause and a colon.
     *
     * The old body — "Welcome to Group Trip Planner. Confirm your email:" — read
     * as a machine's label for the button under it. This is the very first thing
     * a new account ever receives from us and it is the message most likely to
     * be sitting in a spam folder looking suspicious, so it says who it is, what
     * it is for, and what happens if it was not asked for. That last line is not
     * politeness: an unexpected verification mail means someone typed the wrong
     * address, and the only safe instruction is to ignore it.
     */
    const html = renderEmail({
      webAppUrl: this.env.WEB_APP_URL,
      body:
        p(t("Thanks for signing up — welcome aboard!")) +
        p(
          t(
            "One quick thing before you can start planning: confirm this is your email address by pressing the button below.",
          ),
        ),
      action: { label: t("Verify my email"), href: link },
      footer: fine(
        t(
          "Didn't sign up? Then someone mistyped their address — you can ignore this email and nothing will happen.",
        ),
      ),
    });

    if (this.resend) {
      await this.resend.emails.send({
        from: this.env.EMAIL_FROM,
        to,
        subject,
        html,
      });
    } else {
      this.logger.log(`[DEV EMAIL] verification link for ${to}: ${link}`);
    }
  }

  /**
   * Sent when a personal invite link is created with a target address (SRS
   * FR-13). The link stays unbound — the recipient is not verified against the
   * address — so this is a convenience delivery, not an access control.
   */
  async sendInviteEmail(
    to: string,
    rawToken: string,
    tripName: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const t = (
      message: string,
      params?: Readonly<Record<string, string | number>>,
    ) => interpolate(translate(message, locale), params);
    const link = `${this.env.WEB_APP_URL}/join/${encodeURIComponent(rawToken)}`;
    // The trip name is user-supplied and this mail goes to an address the
    // inviter types, so an unescaped name would let anyone compose arbitrary
    // markup — a link of their choosing — inside a mail sent from our domain
    // (Phase 7.2). The subject is a plain-text JSON field, not a header we
    // assemble, so it needs no escaping; the HTML body does.
    const subject = t(`You're invited to "{trip}"`, { trip: tripName });
    const html = renderEmail({
      webAppUrl: this.env.WEB_APP_URL,
      body: p(
        t(`You've been invited to join "{trip}" on Group Trip Planner.`, {
          trip: escapeHtml(tripName),
        }),
      ),
      action: { label: t("Open the invite"), href: link },
    });

    if (this.resend) {
      await this.resend.emails.send({
        from: this.env.EMAIL_FROM,
        to,
        subject,
        html,
      });
    } else {
      this.logger.log(`[DEV EMAIL] invite link for ${to}: ${link}`);
    }
  }

  /**
   * Sent to an address that tried to register but already has an account, so the
   * registration response can stay identical for new vs existing emails (no
   * enumeration) while still being helpful to the real owner.
   */
  async sendAccountExistsNotice(
    to: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<void> {
    const t = (message: string) => translate(message, locale);
    const subject = t("You already have an account");
    const html = renderEmail({
      webAppUrl: this.env.WEB_APP_URL,
      // No button. The one thing this mail must not do is put a prominent
      // "sign in here" link in front of somebody who did not ask for it — the
      // recipient is by definition an address someone else just typed.
      body: p(
        t(
          "Someone tried to register with this email. If it was you, just log in — no new account was created.",
        ),
      ),
    });

    if (this.resend) {
      await this.resend.emails.send({
        from: this.env.EMAIL_FROM,
        to,
        subject,
        html,
      });
    } else {
      this.logger.log(`[DEV EMAIL] account-exists notice for ${to}`);
    }
  }

  // --- Notification channel (preference-gated; queue-driven) ------------------

  /**
   * Deliver one `@mention` email (Phase 5.2). Called **only** by the queue
   * worker, never inline from a request: it is allowed to be slow and allowed to
   * fail, because the worker will retry it.
   *
   * Throws on provider failure — that is the signal the worker records as a
   * failed attempt and reschedules.
   */
  async sendMentionEmail(input: {
    to: string;
    tripName: string;
    actorName: string;
    excerpt: string;
    tripId: string;
    unsubscribeToken: string;
    locale?: Locale;
  }): Promise<void> {
    const t = (
      message: string,
      params?: Readonly<Record<string, string | number>>,
    ) =>
      interpolate(translate(message, input.locale ?? DEFAULT_LOCALE), params);
    const tripLink = `${this.env.WEB_APP_URL}/trips/${input.tripId}`;
    const unsubscribeLink = this.unsubscribeUrl(input.unsubscribeToken);
    const subject = t('{name} mentioned you in "{trip}"', {
      name: input.actorName,
      trip: input.tripName,
    });
    const html = renderEmail({
      webAppUrl: this.env.WEB_APP_URL,
      body:
        // The bold is carried *in the value*, not in the catalogue entry: a
        // translator should never be handed a tag they could break, and the
        // emphasis belongs to the name rather than to the sentence.
        p(
          t('{name} mentioned you in "{trip}":', {
            name: `<strong>${escapeHtml(input.actorName)}</strong>`,
            trip: escapeHtml(input.tripName),
          }),
        ) + quote(escapeHtml(input.excerpt)),
      action: { label: t("Open the trip"), href: tripLink },
      // Outside the card rather than under a rule inside it. This is the only
      // mail here with small print, and it is *about* the mail rather than part
      // of it — which is also where a reader's eye already looks for it.
      footer: fine(
        `${t("You get this because mention email is on.")} ` +
          `<a href="${unsubscribeLink}" style="color:#0f766e">${t("Unsubscribe")}</a> — ` +
          `${t("it only turns off notification email, never account email.")}`,
      ),
    });

    if (this.resend) {
      await this.resend.emails.send({
        from: this.env.EMAIL_FROM,
        to: input.to,
        subject,
        html,
        // RFC 8058: lets the mail client show its own one-click unsubscribe,
        // which is what keeps bulk-ish mail out of spam folders.
        headers: {
          "List-Unsubscribe": `<${unsubscribeLink}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    } else {
      this.logger.log(
        `[DEV EMAIL] mention email for ${input.to} (${subject}) — unsubscribe: ${unsubscribeLink}`,
      );
    }
  }

  /** The unauthenticated one-click endpoint the link points at. */
  private unsubscribeUrl(token: string): string {
    return `${this.env.API_PUBLIC_URL}/email/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}

/** Minimal escaping — user-supplied names and message excerpts go into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
