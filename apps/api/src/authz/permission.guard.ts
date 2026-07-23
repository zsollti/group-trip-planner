import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can, type TripAction } from "@gtp/types";
import type { RequestWithTripContext } from "../trips/trip-context.js";
import { REQUIRE_PERMISSION_KEY } from "./require-permission.decorator.js";

/**
 * Enforces the {@link TripAction} declared by {@link RequirePermission}, using
 * the caller's role that {@link TripContextGuard} resolved from the DB and
 * attached to the request. Must run **after** TripContextGuard so the context
 * is present. The role is read only from that server-resolved context — never
 * from the client, never from the JWT — which is the IDOR defense stated in
 * SRS §7: kick/block/role changes take effect on the very next request.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.getAllAndOverride<TripAction | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    // A route behind this guard with no declared permission is a wiring bug, not
    // an authorization decision — fail closed rather than silently allow.
    if (!action) {
      throw new Error(
        "PermissionGuard used on a route with no @RequirePermission",
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithTripContext>();
    const ctx = request.tripContext;
    if (!ctx) {
      throw new Error(
        "PermissionGuard used without TripContextGuard resolving a trip context",
      );
    }

    if (!can(ctx.role, action)) {
      throw new ForbiddenException("You don't have permission to do this.");
    }
    return true;
  }
}
