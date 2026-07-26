import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { verifyUnsubscribeToken } from "./unsubscribe.token.js";

/**
 * One-click unsubscribe (Phase 5.2, FR-36) — deliberately **unauthenticated**.
 * The link is clicked from a mail client that has no session and may never have
 * had one on this device; requiring a login to stop unwanted mail is exactly the
 * dark pattern the requirement exists to prevent.
 *
 * The signed token is the only credential, and it authorizes exactly one thing:
 * turning **this** user's `emailOnMention` off. It cannot read, cannot write
 * anything else, and cannot touch transactional mail — verification and
 * account-recovery email keep flowing, unsubscribed or not.
 *
 * Two entry points for the two ways clients unsubscribe:
 *
 * - `POST` — RFC 8058 one-click, what the `List-Unsubscribe-Post` header drives.
 * - `GET` — the visible link in the email body, which applies and then renders a
 *   plain confirmation page so the flow works with no frontend at all. (5.3
 *   replaces this page with a proper landing that can also re-subscribe.)
 *
 * A GET that applies is a considered trade-off: a link-prefetching scanner could
 * unsubscribe someone without a human clicking. The cost is one silenced,
 * fully reversible preference — versus a confirm-button page that strands every
 * client that cannot render it. Reversibility is what makes this the right side.
 */
@Controller("email/unsubscribe")
export class UnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** RFC 8058 one-click. Body is ignored; the token in the URL is the whole request. */
  @Post()
  @HttpCode(200)
  async unsubscribePost(@Query("token") token?: string): Promise<{ ok: true }> {
    await this.apply(token);
    return { ok: true };
  }

  /** The visible link in the email body. */
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  async unsubscribeGet(@Query("token") token?: string): Promise<string> {
    await this.apply(token);
    return (
      `<!doctype html><meta charset="utf-8">` +
      `<title>Unsubscribed</title>` +
      `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>You're unsubscribed</h1>` +
      `<p>We won't email you when someone @mentions you. ` +
      `You'll still see mentions in the app, and account emails ` +
      `(verification, sign-in help) are unaffected.</p>` +
      `<p><a href="${this.env.WEB_APP_URL}">Back to Group Trip Planner</a></p>` +
      `</body>`
    );
  }

  /**
   * Verify the token and turn the preference off. Idempotent — unsubscribing
   * twice is a success, not an error.
   *
   * An unknown user id is treated as success too: the token verified, so there
   * is nothing to tell the caller, and answering differently would turn this
   * endpoint into an account-existence oracle for anyone holding an old link.
   */
  private async apply(token?: string): Promise<void> {
    const userId = token
      ? verifyUnsubscribeToken(token, this.env.JWT_SECRET)
      : null;
    if (!userId) throw new BadRequestException("Invalid unsubscribe link");
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { emailOnMention: false },
    });
  }
}
