import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { RequestWithTripContext, TripContext } from "./trip-context.js";

/**
 * Injects the {@link TripContext} that {@link TripContextGuard} resolved and
 * attached to the request. Only valid on routes behind that guard.
 */
export const TripCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TripContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithTripContext>();
    if (!request.tripContext) {
      throw new Error(
        "TripCtx used on a route not protected by TripContextGuard",
      );
    }
    return request.tripContext;
  },
);
