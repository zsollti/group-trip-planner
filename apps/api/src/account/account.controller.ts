import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import type { User } from "@prisma/client";
import {
  DeleteAccountInput,
  UpdateNotificationPreferencesInput,
  UpdateProfileInput,
  type AccountDeletionImpact,
  type AuthUser,
  type NotificationPreferences,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { VerifiedEmailGuard } from "../auth/verified-email.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { clearRefreshCookie } from "../auth/cookies.js";
import { UserThrottlerGuard } from "../common/user-throttler.guard.js";
import type { UploadedImageFile } from "../uploads/uploads.service.js";
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

  /**
   * Rename yourself (post-launch).
   *
   * **Not gated on a verified email**, unlike creating a trip or an invite.
   * Those are the high-risk actions verification exists to slow down (SRS §3);
   * changing the name on your own account affects nobody who has not already
   * chosen to plan with you, and an unverified account with a typo in its name
   * being unable to fix it is a worse outcome than the one being prevented.
   */
  @Patch("profile")
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateProfileInput))
    body: UpdateProfileInput,
  ): Promise<AuthUser> {
    return this.account.updateProfile(user, body);
  }

  /**
   * Set or replace the caller's avatar (Phase 6.2). Multipart in one step, for
   * the same reason as the trip cover: a client that could name the URL could
   * point every page showing this user at an address of its choosing.
   */
  @Post("avatar")
  @UseGuards(JwtAuthGuard, VerifiedEmailGuard, UserThrottlerGuard)
  @UseInterceptors(FileInterceptor("file"))
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<AuthUser> {
    if (!file) {
      throw new BadRequestException("No file was uploaded (field name: file).");
    }
    return this.account.setAvatar(user, file);
  }

  /** Remove the avatar, deleting the stored object with it. */
  @Delete("avatar")
  @UseGuards(JwtAuthGuard)
  removeAvatar(@CurrentUser() user: User): Promise<AuthUser> {
    return this.account.removeAvatar(user);
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
