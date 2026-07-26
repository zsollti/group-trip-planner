import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { User } from "@prisma/client";
import {
  DeleteAccountInput,
  UpdateNotificationPreferencesInput,
  type AccountDeletionImpact,
  type NotificationPreferences,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { clearRefreshCookie } from "../auth/cookies.js";
import { AccountService } from "./account.service.js";

/**
 * The signed-in user's own account (Phase 1.5, SRS FR-6). Both routes act on the
 * caller only — the user id comes from the authenticated session, never the body,
 * so there is no target to authorize beyond "is logged in".
 */
@Controller("account")
export class AccountController {
  constructor(
    private readonly account: AccountService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The caller's notification preferences (Phase 5.3). */
  @Get("preferences")
  @UseGuards(JwtAuthGuard)
  getPreferences(@CurrentUser() user: User): Promise<NotificationPreferences> {
    return this.account.getPreferences(user.id);
  }

  /**
   * Update the caller's notification preferences. Gates only the **email**
   * channel — the in-app bell stays on, and transactional mail never reads this.
   */
  @Patch("preferences")
  @UseGuards(JwtAuthGuard)
  updatePreferences(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesInput))
    body: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    return this.account.updatePreferences(user.id, body);
  }

  /** Preview what deleting this account will do (the warning prompt's source). */
  @Get("deletion-preview")
  @UseGuards(JwtAuthGuard)
  preview(@CurrentUser() user: User): Promise<AccountDeletionImpact> {
    return this.account.previewDeletion(user.id);
  }

  /**
   * Delete this account (GDPR erasure) — always available. Requires an explicit
   * `confirm: true`. On success the refresh cookie is cleared (its token is also
   * revoked server-side) and the reply is 204.
   */
  @Delete()
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async delete(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(DeleteAccountInput)) _body: DeleteAccountInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.deleteAccount(user.id);
    clearRefreshCookie(res, this.env);
  }
}
