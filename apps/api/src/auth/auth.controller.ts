import {
  Body,
  Controller,
  Get,
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
  type AuthUser,
  type LoginResult,
  type RegisterResult,
} from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";
import { toAuthUser } from "./auth.mapper.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  setRefreshCookie,
} from "./cookies.js";
import type { User } from "@prisma/client";

/** Tight per-route limits on the credential-bearing endpoints (SRS FR-5). */
const REGISTER_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

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
  ): Promise<RegisterResult> {
    return this.auth.register(body);
  }

  @Post("verify")
  @HttpCode(200)
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
    return toAuthUser(user);
  }
}
