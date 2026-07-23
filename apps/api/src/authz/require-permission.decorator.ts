import { SetMetadata } from "@nestjs/common";
import type { TripAction } from "@gtp/types";

/** Metadata key under which {@link RequirePermission} stashes the action. */
export const REQUIRE_PERMISSION_KEY = "requirePermission";

/**
 * Declares the {@link TripAction} a route requires. The {@link PermissionGuard}
 * reads this and calls the pure `can(role, action)` engine against the role the
 * {@link TripContextGuard} resolved. Authorization is declarative — routes say
 * *what* they need, never *how* it is checked, and never inline a role compare.
 *
 * Usage: `@RequirePermission("trip.edit")` on a handler behind
 * `@UseGuards(JwtAuthGuard, TripContextGuard, PermissionGuard)`.
 */
export const RequirePermission = (action: TripAction) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, action);
