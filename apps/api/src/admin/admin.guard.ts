import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import type { User } from "@prisma/client";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { isAdminEmail } from "./is-admin.js";

/**
 * Gates every `/admin` route. Runs after {@link JwtAuthGuard}, so there is
 * always an authenticated user to check.
 *
 * **Answers 404, not 403.** Everywhere else in this API a 403 is the honest and
 * more useful reply — it tells a member they need to verify their email, or
 * that this is an organizer's button. Here the same reply would confirm to
 * anyone who asks that an admin console exists at this path and that they are
 * merely not on the list, which is a free hint on the one surface where
 * guessing is worth someone's time. To a non-operator the console does not
 * exist — which is also literally true of any deployment that leaves
 * `ADMIN_EMAILS` empty.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    if (!isAdminEmail(request.user?.email, this.env.ADMIN_EMAILS)) {
      throw new NotFoundException(`Cannot ${request.method} ${request.path}`);
    }
    return true;
  }
}
