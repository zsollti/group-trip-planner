import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  LoginInput,
  RegisterInput,
  VerifyEmailInput,
  resolveLocale,
  type AuthUser,
  type LoginResult,
  type RegisterResult,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import {
  GoogleAuthGuard,
  GoogleConfiguredGuard,
  resolveReturnUrl,
} from "./google-auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";
import { toAuthUser } from "./auth.mapper.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from "./cookies.js";
import type { User } from "@prisma/client";
import {
  LOGIN_THROTTLE,
  REGISTER_THROTTLE,
  VERIFY_THROTTLE,
} from "../common/throttle-policy.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post("register")
  @Throttle(REGISTER_THROTTLE)
  register(
    @Body(new ZodValidationPipe(RegisterInput)) body: RegisterInput,
    // The reader's language, from the browser (or from the board, which sends the
    // language it is *displaying*). A brand-new account has no stored preference
    // yet and its verification email is the first thing it ever receives, so this
    // header is the only signal there is — and it becomes the account's stored
    // language, which is why every later email can simply read the column.
    @Headers("accept-language") acceptLanguage?: string,
  ): Promise<RegisterResult> {
    return this.auth.register(body, resolveLocale(acceptLanguage));
  }

  /**
   * Redeem a verification token. Throttled since 7.1: it was covered only by
   * the global IP floor, which allowed ~100 guesses a minute against a token
   * whose entire security property is being unguessable.
   */
  @Post("verify")
  @HttpCode(200)
  @Throttle(VERIFY_THROTTLE)
  verify(
    @Body(new ZodValidationPipe(VerifyEmailInput)) body: VerifyEmailInput,
  ): Promise<AuthUser> {
    return this.auth.verifyEmail(body.token);
  }

  @Post("login")
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  async login(
    @Body(new ZodValidationPipe(LoginInput)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const { result, refresh } = await this.auth.login(body);
    setRefreshCookie(res, refresh.raw, refresh.expiresAt, this.env);
    return result;
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new UnauthorizedException();
    const { result, refresh } = await this.auth.refresh(raw);
    setRefreshCookie(res, refresh.raw, refresh.expiresAt, this.env);
    return result;
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);
    clearRefreshCookie(res, this.env);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): AuthUser {
    return toAuthUser(user, this.env.ADMIN_EMAILS);
  }

  /**
   * Begin Google sign-in (Phase 1.0). GoogleAuthGuard redirects the browser to
   * Google's consent screen; the caller's `?redirect=` (which app to return to)
   * and `?next=` (where inside it to land — an invite's `/join/:token`, say)
   * ride along as OAuth `state`. 404s when Google isn't configured.
   */
  @Get("google")
  @UseGuards(GoogleConfiguredGuard, GoogleAuthGuard)
  googleStart(): void {
    // Never reached — the guard issues the redirect to Google.
  }

  /**
   * Google's redirect target. The guard completes the code exchange and attaches
   * the resolved User; here we open the standard session (refresh cookie set like
   * email/password login) and bounce back to the originating front-end — to the
   * path the user was headed for, so a logged-out invite survives the Google
   * detour — which silently refreshes to obtain its access token. The token is
   * never placed in the URL.
   */
  @Get("google/callback")
  @UseGuards(GoogleConfiguredGuard, GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { refresh } = await this.auth.startSession(user);
    setRefreshCookie(res, refresh.raw, refresh.expiresAt, this.env);
    res.redirect(resolveReturnUrl(req.query.state, this.env));
  }
}
