import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Access-token claims — authentication only. Authorization is never read from
 * the token; it is resolved per-request from the DB (SRS FR-4). */
interface AccessTokenClaims {
  sub: string;
  email: string;
}

/** A freshly issued opaque token plus its absolute expiry. */
export interface IssuedToken {
  raw: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Opaque, high-entropy secret sent to the client; only its hash is stored. */
  private random(): string {
    return randomBytes(32).toString("base64url");
  }

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Short-lived access JWT (expiry from JwtModule signOptions). */
  signAccessToken(user: Pick<User, "id" | "email">): Promise<string> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email };
    return this.jwt.signAsync(claims);
  }

  async issueRefreshToken(userId: string): Promise<IssuedToken> {
    const raw = this.random();
    const expiresAt = new Date(
      Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hash(raw), expiresAt },
    });
    return { raw, expiresAt };
  }

  /**
   * Validate a presented refresh token and rotate it: the old token is revoked
   * and a new one issued, atomically. If a token that was already rotated away
   * is presented again (reuse — a theft signal), the entire token family for
   * that user is revoked.
   */
  async rotateRefreshToken(
    raw: string,
  ): Promise<{ user: User; next: IssuedToken }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
      include: { user: true },
    });

    if (!record) throw new UnauthorizedException();

    if (record.revokedAt) {
      // Reuse of a revoked token — revoke all live tokens for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException();
    }

    if (record.expiresAt <= new Date() || record.user.anonymizedAt) {
      throw new UnauthorizedException();
    }

    const nextRaw = this.random();
    const expiresAt = new Date(
      Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: this.hash(nextRaw),
          expiresAt,
        },
      }),
    ]);

    return { user: record.user, next: { raw: nextRaw, expiresAt } };
  }

  /** Revoke a refresh token on logout (no-op if unknown/already revoked). */
  async revokeRefreshToken(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issueEmailVerificationToken(userId: string): Promise<string> {
    const raw = this.random();
    const expiresAt = new Date(
      Date.now() + this.env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    );
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: this.hash(raw), expiresAt },
    });
    return raw;
  }

  /** Validate + single-use consume a verification token; returns the userId. */
  async consumeEmailVerificationToken(raw: string): Promise<string> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid or expired verification token");
    }
    await this.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return record.userId;
  }
}
