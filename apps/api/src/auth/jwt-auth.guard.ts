import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Authentication guard for access-token-protected routes.
 *
 * Validates the Bearer access token, then loads the user fresh from the DB on
 * every request (never trusting anything but `sub` from the token). This is the
 * per-request DB check the whole authorization model is built on (SRS FR-4);
 * a deleted/anonymized user is rejected immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException();
    }
    const token = header.slice("Bearer ".length);

    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.anonymizedAt) {
      throw new UnauthorizedException();
    }

    // Attach for @CurrentUser().
    (request as Request & { user: typeof user }).user = user;
    return true;
  }
}
