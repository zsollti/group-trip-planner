import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type {
  AdminAuditLog,
  AdminOverview,
  AdminUserLookup,
  AdminUserSummary,
} from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

/**
 * The operator's console (post-launch).
 *
 * Both guards, on the controller rather than per-route, so a route added here
 * later cannot be born unguarded — this is the one surface in the app where a
 * forgotten decorator would be an open door rather than a bug. The IDOR sweep
 * reads Express's own route table and would catch it, but not before the code
 * existed to catch.
 */
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Everything the landing view shows, in one request. */
  @Get("overview")
  overview(): Promise<AdminOverview> {
    return this.admin.overview();
  }

  /** Find people by email fragment, display name, or exact id. */
  @Get("users")
  lookup(@Query("q") q?: string): Promise<AdminUserLookup> {
    return this.admin.lookupUsers(q ?? "");
  }

  /** Issue and send a fresh verification link. */
  @Post("users/:id/resend-verification")
  resendVerification(
    @CurrentUser() actor: User,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AdminUserSummary> {
    return this.admin.resendVerification(actor.email, id);
  }

  /** Mark an account verified without the email round trip. */
  @Post("users/:id/verify")
  markVerified(
    @CurrentUser() actor: User,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AdminUserSummary> {
    return this.admin.markVerified(actor.email, id);
  }

  /** What operators have done here, newest first. */
  @Get("audit")
  audit(): Promise<AdminAuditLog> {
    return this.admin.auditLog();
  }
}
