import { z } from "zod";

/**
 * Suspending an account, app-wide (post-launch).
 *
 * The trip-scoped {@link TripBlock} already existed and is a different thing: it
 * keeps one person off one board, decided by that board's organizer. This is the
 * operator's version — the account cannot sign in at all, anywhere — and it is
 * deliberately the only power in this app that reaches across trips.
 *
 * ## Three fields, and why each is separate
 *
 * `bannedAt` is the switch. `bannedUntil` is the end, and **null means
 * permanent** — not "no end recorded", because a ban with no end *is* the
 * permanent one, and modelling permanence as a far-future date would leave the
 * app deciding how far is far enough. `banReason` is the sentence the person
 * reads when they try to sign in, so it is required rather than optional: an
 * account that stops working for no stated reason is the failure mode this whole
 * feature exists to avoid.
 *
 * ## A lapsed ban is not a ban
 *
 * Expiry is evaluated on read ({@link banIsActive}), never by a job that sweeps
 * rows at midnight. A scheduled unban would be a second source of truth about
 * the same question and would need a scheduler this app does not have; asking
 * "is it still running?" at the moment somebody tries to sign in is both simpler
 * and correct the instant the clock passes. The row survives its own expiry on
 * purpose, so the console can still show that this account *was* suspended and
 * why — which is exactly what an operator needs when the same person comes back.
 */

/** How long a reason may be. Long enough for a paragraph, short of an essay. */
export const BAN_REASON_MAX = 500;

/**
 * What an operator sends to suspend an account.
 *
 * `until` is a plain calendar date (`YYYY-MM-DD`), or null for permanent. A date
 * rather than an instant because that is the decision actually being made — "a
 * fortnight", "until the end of the month" — and an hour-and-minute picker would
 * invite a precision nobody has. The server reads it as midnight UTC, so the ban
 * lifts *at the start of* the named day and the message says "until" it.
 */
export const BanUserInput = z.object({
  /** `YYYY-MM-DD`, or null for a permanent suspension. */
  until: z.string().date().nullable(),
  /** Shown to the suspended person verbatim. Required — see the note above. */
  reason: z.string().trim().min(1).max(BAN_REASON_MAX),
});
export type BanUserInput = z.infer<typeof BanUserInput>;

/**
 * A suspension as it is stored and as it is reported.
 *
 * The field names are the database's, not a prettier set, so that this and a
 * Prisma `user` row satisfy {@link BanFields} alike and {@link banIsActive} can
 * be asked about either without a mapping step in between. The mapping step is
 * where the two would eventually disagree.
 */
export const BanState = z.object({
  bannedAt: z.string().datetime(),
  /** Null means permanent. */
  bannedUntil: z.string().datetime().nullable(),
  banReason: z.string(),
});
export type BanState = z.infer<typeof BanState>;

/** The three columns, in whatever shape they arrive — a Prisma row or a payload. */
export interface BanFields {
  readonly bannedAt: Date | string | null;
  readonly bannedUntil: Date | string | null;
  readonly banReason: string | null;
}

/**
 * Is this account suspended *right now*?
 *
 * Pure, shared, and the only place the question is answered: the login path, the
 * refresh path, the per-request guard and the operator's console all ask it, and
 * four hand-rolled `bannedAt !== null &&` conditions is three chances for one of
 * them to forget the expiry half.
 *
 * `now` is a parameter rather than a `new Date()` inside, which is what makes
 * "the minute after it lapses" a test rather than a wait.
 */
export function banIsActive(user: BanFields, now: Date = new Date()): boolean {
  if (user.bannedAt === null) return false;
  if (user.bannedUntil === null) return true;
  return new Date(user.bannedUntil).getTime() > now.getTime();
}

/**
 * The calendar day a ban ends, as `YYYY-MM-DD`, or null when it is permanent.
 *
 * Sliced off the ISO instant rather than formatted, and that is the whole reason
 * this exists as a function: `bannedUntil` is stored as midnight **UTC** of the
 * date an operator picked, so rendering it through a local-time formatter can
 * hand back the day before. The stored instant means a calendar day, and this is
 * the one reading of it that stays the day that was chosen.
 */
export function banEndDate(user: BanFields): string | null {
  if (user.bannedUntil === null) return null;
  return new Date(user.bannedUntil).toISOString().slice(0, 10);
}
