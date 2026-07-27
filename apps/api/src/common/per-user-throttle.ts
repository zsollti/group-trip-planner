import { SetMetadata, applyDecorators } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { ExecutionContext } from "@nestjs/common";

/** Marks a route whose budget belongs to the account, not the address. */
export const PER_USER_THROTTLE = "gtp:per-user-throttle";

/** A `@Throttle()` budget. `ttl` is milliseconds. */
type Budget = { default: { limit: number; ttl: number } };

/**
 * Declare a per-user rate limit on a route (Phase 7.1).
 *
 * Use with `UserThrottlerGuard` in the route's guard chain. Together they mean
 * "this budget belongs to the account", and the marker is what makes that
 * true rather than merely intended — see {@link GlobalThrottlerGuard}.
 */
export function PerUserThrottle(budget: Budget) {
  return applyDecorators(
    Throttle(budget),
    SetMetadata(PER_USER_THROTTLE, true),
  );
}

/**
 * The application-wide rate-limit floor, with one correction.
 *
 * The stock `ThrottlerGuard` bound as `APP_GUARD` runs on *every* route and
 * reads whatever `@Throttle()` metadata it finds there — but it tracks by IP.
 * So a route that tightened its budget for per-user reasons had that same
 * tightened number silently applied per address as well, and the stricter of
 * the two bit first. The effect was the exact failure the per-user tracker was
 * introduced to avoid: everyone behind one office NAT shared a budget, so a
 * colleague could spend your upload or trip-creation allowance. It went
 * unnoticed because the two limits are equal, so nothing looked wrong until
 * two accounts were exercised from one address (Phase 7.1 test).
 *
 * This guard therefore stands aside on routes marked {@link PerUserThrottle},
 * leaving them to the per-user guard alone. Every other route is unchanged and
 * still gets the IP-keyed floor — which is what protects the pre-auth routes,
 * where there is no user to key on.
 */
export class GlobalThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    return (
      this.reflector.getAllAndOverride<boolean>(PER_USER_THROTTLE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
