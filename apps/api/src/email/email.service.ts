import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/**
 * Transactional email (verification, "account already exists").
 *
 * In dev / without a Resend key, the message is logged so the verification link
 * is visible in the console. When RESEND_API_KEY is set (staging/prod) the same
 * calls send real email. Transactional email is a strictly separate path from
 * notification email and is never gated by user preferences (SRS FR-36).
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
    const subject = `You're invited to "${tripName}"`;
    const html = `<p>You've been invited to join "${tripName}" on Group Trip Planner.</p><p><a href="${link}">Open the invite</a></p>`;

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
}
