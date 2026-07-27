import type { User } from "@prisma/client";
import type { AuthUser } from "@gtp/types";

/**
 * Projects a full User row down to the public {@link AuthUser} shape returned by
 * the auth endpoints. Typed as the shared contract so a drift between the DB
 * model and the contract fails the build here.
 */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
  };
}
