import type { User } from "@prisma/client";
import type { AuthUser } from "@gtp/types";
import { resolveLocale } from "@gtp/types";
import { isAdminEmail } from "../admin/is-admin.js";

/**
 * Projects a full User row down to the public {@link AuthUser} shape returned by
 * the auth endpoints. Typed as the shared contract so a drift between the DB
 * model and the contract fails the build here.
 *
 * `adminEmails` is passed in rather than read from a service, because operator
 * status is configuration and this is a pure mapper — the caller already holds
 * the env, and threading it keeps the auth module from importing the console's.
 */
export function toAuthUser(
  user: User,
  adminEmails: readonly string[],
): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    isAdmin: isAdminEmail(user.email, adminEmails),
    // Through `resolveLocale` rather than cast: the column is text, so the one
    // thing it can hold that the contract cannot express is a language this build
    // has stopped offering — a row written by a later version, or by hand. That
    // must degrade to the default, not fail the session payload and lock the
    // account out of the app.
    locale: resolveLocale(user.locale),
  };
}
