/**
 * Who counts as an operator — a pure function over the configured list.
 *
 * Deliberately not an injectable service. The question is asked from two sides
 * that must not depend on each other: the guard on every `/admin` route, and
 * the auth mapper that decides whether to offer the link at all. A provider
 * would have put the console's module and the auth module in a cycle; a
 * function each of them imports has no direction to be circular in.
 *
 * The configured list arrives already trimmed and lowercased from the env
 * schema. The candidate is lowercased here, so an account registered as
 * `Zsolt@…` matches a Railway variable written `zsolt@…` — an operator setting
 * their own address should not have to think about case.
 *
 * An empty list matches nothing, which is what keeps the console off in every
 * deployment that has not deliberately switched it on, including all of them by
 * default.
 */
export function isAdminEmail(
  email: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!email) return false;
  return allowed.includes(email.trim().toLowerCase());
}
