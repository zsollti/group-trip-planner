import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

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
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  }

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const link = `${this.env.WEB_APP_URL}/verify?token=${encodeURIComponent(rawToken)}`;
    const subject = "Verify your email";
    const html = `<p>Welcome to Group Trip Planner. Confirm your email:</p><p><a href="${link}">Verify my email</a></p>`;

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
  ): Promise<void> {
    const link = `${this.env.WEB_APP_URL}/join/${encodeURIComponent(rawToken)}`;
    // The trip name is user-supplied and this mail goes to an address the
    // inviter types, so an unescaped name would let anyone compose arbitrary
    // markup — a link of their choosing — inside a mail sent from our domain
    // (Phase 7.2). The subject is a plain-text JSON field, not a header we
    // assemble, so it needs no escaping; the HTML body does.
    const subject = `You're invited to "${tripName}"`;
    const html =
      `<p>You've been invited to join "${escapeHtml(tripName)}" on ` +
      `Group Trip Planner.</p><p><a href="${link}">Open the invite</a></p>`;

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
  async sendAccountExistsNotice(to: string): Promise<void> {
    const subject = "You already have an account";
    const html = `<p>Someone tried to register with this email. If it was you, just log in — no new account was created.</p>`;

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
  }): Promise<void> {
    const tripLink = `${this.env.WEB_APP_URL}/trips/${input.tripId}`;
    const unsubscribeLink = this.unsubscribeUrl(input.unsubscribeToken);
    const subject = `${input.actorName} mentioned you in "${input.tripName}"`;
    const html =
      `<p><strong>${escapeHtml(input.actorName)}</strong> mentioned you in ` +
      `"${escapeHtml(input.tripName)}":</p>` +
      `<blockquote>${escapeHtml(input.excerpt)}</blockquote>` +
      `<p><a href="${tripLink}">Open the trip</a></p>` +
      `<hr><p style="font-size:12px;color:#666">` +
      `You get this because "email me when I'm @mentioned" is on. ` +
      `<a href="${unsubscribeLink}">Unsubscribe</a> — it only turns off ` +
      `notification email, never account email.</p>`;

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
