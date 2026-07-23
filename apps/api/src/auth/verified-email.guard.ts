import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { User } from "@prisma/client";

/**
 * Gates the high-risk actions that require a verified email (SRS §3): creating
 * trips, creating invite links, and being promoted to Co-organizer/Owner.
 * Viewing, chatting, voting and proposing do NOT require verification, so this
 * guard is applied per-route, never globally. Runs after {@link JwtAuthGuard}.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: User }>();
    if (!request.user?.emailVerified) {
      throw new ForbiddenException(
        "Please verify your email address to do this.",
      );
    }
    return true;
  }
}
