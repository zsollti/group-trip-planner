import { randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";
import type { User } from "@prisma/client";
import type {
  AuthUser,
  Locale,
  LoginInput,
  LoginResult,
  RegisterInput,
  RegisterResult,
} from "@gtp/types";
import { DEFAULT_LOCALE, resolveLocale } from "@gtp/types";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "../email/email.service.js";
import { TokenService, type IssuedToken } from "./token.service.js";
import { toAuthUser } from "./auth.mapper.js";

const ARGON2_OPTIONS = { type: argon2.argon2id } as const;

/** login/refresh produce the access token + user and a refresh token to set as
 * a cookie by the controller. */
interface AuthSession {
  result: LoginResult;
  refresh: IssuedToken;
}

@Injectable()
export class AuthService {
  /** Precomputed hash to verify against for unknown accounts, so login timing
   * doesn't reveal whether an email exists. Built lazily, once. */
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await argon2.hash(
      randomBytes(16).toString("hex"),
      ARGON2_OPTIONS,
    );
    return this.dummyHash;
  }

  /**
   * Register a new email/password account. Enumeration-safe: the response is
   * identical whether or not the email already exists, and both branches do the
   * same argon2 work so timing doesn't leak existence either.
   */
  async register(
    input: RegisterInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<RegisterResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      // Equalize timing with the create branch, then nudge the real owner.
      await argon2.hash(input.password, ARGON2_OPTIONS);
      // The existing account's own language, not the language of whoever
      // triggered this: the notice goes to the person who owns the address, and
      // they may not be the one who just typed it into a sign-up form.
      await this.email.sendAccountExistsNotice(
        input.email,
        resolveLocale(existing.locale),
      );
      return { status: "verification_sent" };
    }

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        emailVerified: false,
        locale,
      },
    });
    const rawToken = await this.tokens.issueEmailVerificationToken(user.id);
    await this.email.sendVerificationEmail(user.email, rawToken, locale);
    return { status: "verification_sent" };
  }

  async verifyEmail(rawToken: string): Promise<AuthUser> {
    const userId = await this.tokens.consumeEmailVerificationToken(rawToken);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
    return toAuthUser(user, this.env.ADMIN_EMAILS);
  }

  /**
   * Verify credentials and open a session. Unknown email and wrong password
   * yield the same generic 401, and both run an argon2 verify (against a dummy
   * hash for unknown accounts) to keep timing uniform. Email verification is NOT
   * required to log in — it only gates high-risk actions later (SRS §3).
   */
  async login(input: LoginInput): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    const hash = user?.passwordHash ?? (await this.getDummyHash());

    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hash, input.password);
    } catch {
      passwordOk = false;
    }

    if (!user || !user.passwordHash || !passwordOk || user.anonymizedAt) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.openSession(user);
  }

  /**
   * Find-or-create the User behind a verified Google profile (Phase 1.0, FR-1).
   * Google has already proven ownership of the email, so:
   *  - an existing account is reused (and marked `emailVerified` if it wasn't —
   *    signing in with Google verifies the address);
   *  - a brand-new account is created with no password (`passwordHash` null) and
   *    `emailVerified: true` on arrival.
   * A deleted (anonymized) account is refused. Downstream, a Google user and an
   * email/password user are the same `User` shape (SRS §Phase-1.0 DoD).
   *
   * Note (accepted MVP risk): linking is by email. A pre-existing *unverified*
   * local account for the same address is adopted here; Google's proof of
   * ownership makes this safe for the real owner, and unverified accounts can
   * take no high-risk action until this point anyway.
   */
  async validateGoogleProfile(profile: {
    email: string;
    displayName: string;
  }): Promise<User> {
    const email = profile.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.anonymizedAt) {
        throw new UnauthorizedException("This account has been deleted.");
      }
      if (!existing.emailVerified) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { emailVerified: true },
        });
      }
      return existing;
    }

    const displayName =
      profile.displayName.trim() || email.split("@")[0] || "Traveler";
    return this.prisma.user.create({
      data: { email, displayName, emailVerified: true },
    });
  }

  /**
   * Open a session for an already-authenticated user (the OAuth callback path).
   * Shares the exact access + refresh issuance of email/password login, so a
   * Google sign-in yields the same token pair.
   */
  startSession(user: User): Promise<AuthSession> {
    return this.openSession(user);
  }

  async refresh(rawToken: string): Promise<AuthSession> {
    const { user, next } = await this.tokens.rotateRefreshToken(rawToken);
    const accessToken = await this.tokens.signAccessToken(user);
    return {
      result: { accessToken, user: toAuthUser(user, this.env.ADMIN_EMAILS) },
      refresh: next,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revokeRefreshToken(rawToken);
  }

  private async openSession(user: User): Promise<AuthSession> {
    const accessToken = await this.tokens.signAccessToken(user);
    const refresh = await this.tokens.issueRefreshToken(user.id);
    return {
      result: { accessToken, user: toAuthUser(user, this.env.ADMIN_EMAILS) },
      refresh,
    };
  }
}
