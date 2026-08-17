import type { TripRole } from "./trips.js";
import { ROLE_RANK } from "./permissions.js";

/**
 * The policy layer (Phase 1.4, SRS FR-11) — all runtime-resolved limits in one
 * place, as pure functions, so there is **no hardcoded constant** sprinkled
 * through the handlers. Today every trip resolves to the same defaults; the
 * seam exists so a subscription tier can raise them post-MVP by passing a
 * per-trip override, without touching a single call site. Callers ask the
 * policy ("what is the cap for *this* trip?") rather than comparing against a
 * literal.
 */

/** Default member cap for a trip (SRS FR-11: 30, subscription-configurable). */
export const DEFAULT_MAX_TRIP_MEMBERS = 30;

/** Default planning horizon in days — stubbed here, enforced in Phase 2. */
export const DEFAULT_MAX_TRIP_HORIZON_DAYS = 365;

/**
 * Default cap on a trip's categories: the four seeded built-ins
 * ({@link BUILTIN_CATEGORIES}) plus four of your own. A board shows its
 * categories as lanes in one horizontal row, so the limit is as much a layout
 * constraint as a quota — past eight, the row stops being scannable and every
 * lane gets too narrow to read. That is why the number did **not** drop when
 * Budget left the seed: eight is what the row can hold, so retiring a built-in
 * buys a custom lane rather than shrinking the board.
 * Subscription-configurable, like the member cap.
 */
export const DEFAULT_MAX_TRIP_CATEGORIES = 8;

/**
 * Default cap on the options **one category** may hold.
 *
 * A lane is a question a group is meant to answer, and past a certain length it
 * stops being one: eight candidates is already more than a group can hold in
 * mind while voting, and a lane that keeps growing is how a board turns into a
 * list nobody finishes reading. The number matches
 * {@link DEFAULT_MAX_TRIP_CATEGORIES} by coincidence of judgement, not by
 * derivation — they are two different limits and either may move alone.
 *
 * **Locked options count.** The cap bounds what a lane holds, and a decision
 * takes up a lane's room exactly like a proposal does — it is pinned at the top
 * of it. Counting only proposals would also let a multi-select lane grow without
 * end by locking as it went, which is the case the cap most needs to bound.
 *
 * Subscription-configurable, like the two above: this is the limit a paid tier
 * is most likely to raise, which is why the override exists before the tier
 * does.
 */
export const DEFAULT_MAX_CATEGORY_OPTIONS = 8;

/**
 * The minimal, framework-free trip shape the policy functions read. Only the
 * override fields matter; both are optional/nullable and fall back to the
 * defaults, so a bare `{}` (or nothing) yields the MVP limits.
 */
export interface TripPolicyContext {
  /** Per-trip member-cap override (subscription tier, post-MVP). */
  readonly maxMembersOverride?: number | null;
  /** Per-trip horizon override (post-MVP). */
  readonly maxHorizonDaysOverride?: number | null;
  /** Per-trip category-cap override (subscription tier, post-MVP). */
  readonly maxCategoriesOverride?: number | null;
  /** Per-trip options-per-category override (subscription tier, post-MVP). */
  readonly maxCategoryOptionsOverride?: number | null;
}

/**
 * The member cap for a trip (SRS FR-11). Enforced at join; a trip with an
 * override uses it, otherwise the default. Never inline the number at a call
 * site — call this so the cap has exactly one source of truth.
 */
export function maxTripMembers(trip?: TripPolicyContext): number {
  return trip?.maxMembersOverride ?? DEFAULT_MAX_TRIP_MEMBERS;
}

/**
 * The planning-horizon cap in days (SRS FR-11). Stubbed for Phase 2 (date
 * validation): the seam is in place so the horizon check, when it lands, reads
 * the same policy layer as the member cap.
 */
export function maxTripHorizonDays(trip?: TripPolicyContext): number {
  return trip?.maxHorizonDaysOverride ?? DEFAULT_MAX_TRIP_HORIZON_DAYS;
}

/**
 * The category cap for a trip. Enforced when a custom category is created; the
 * board also reads it to stop offering an "add category" affordance the server
 * would refuse. Never inline the number at a call site — call this, so raising
 * the cap for a paid tier is one override rather than a hunt through handlers.
 */
export function maxTripCategories(trip?: TripPolicyContext): number {
  return trip?.maxCategoriesOverride ?? DEFAULT_MAX_TRIP_CATEGORIES;
}

/**
 * How many options one of this trip's categories may hold. Enforced when an
 * option is proposed; the board reads it to stop offering a form the server
 * would refuse, and to say how full the lane is before you find out the hard
 * way. Never inline the number — call this.
 *
 * A **create-time** limit, like the others. A lane already over the cap (an
 * older trip, or one whose tier lapsed) keeps every option it has and simply
 * accepts no more: a quota that deleted what it found would be a data-loss bug
 * wearing a business rule's clothes.
 */
export function maxCategoryOptions(trip?: TripPolicyContext): number {
  return trip?.maxCategoryOptionsOverride ?? DEFAULT_MAX_CATEGORY_OPTIONS;
}

/** A trip member as the successor cascade sees it: role + tenure. */
export interface SuccessorCandidate {
  readonly userId: string;
  readonly role: TripRole;
  /** When they joined — earlier = longer-tenured = higher priority. */
  readonly joinedAt: Date | string;
}

/**
 * The ownership-successor cascade (SRS FR-6), encoded once as a pure function so
 * Phase 1.4 (a suggested default for explicit transfer) and Phase 1.5 (the
 * automatic transfer on account deletion) resolve a successor identically.
 * Given the *other* members of a trip (the departing owner excluded), pick:
 *  - the **longest-tenured Co-organizer**, else
 *  - the **longest-tenured Participant**, else
 *  - `null` (a solo/Guest-only trip — the caller deletes it instead).
 *
 * Guests are never auto-promoted to Owner. Ties break on the earlier `joinedAt`,
 * then the `userId` for total determinism.
 */
export function pickSuccessor(
  candidates: readonly SuccessorCandidate[],
): SuccessorCandidate | null {
  const eligible = candidates.filter(
    (c) => c.role === "CO_ORGANIZER" || c.role === "PARTICIPANT",
  );
  if (eligible.length === 0) return null;

  const time = (c: SuccessorCandidate) => new Date(c.joinedAt).getTime();
  const [best] = [...eligible].sort((a, b) => {
    // Co-organizer outranks Participant regardless of tenure.
    if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) {
      return ROLE_RANK[b.role] - ROLE_RANK[a.role];
    }
    if (time(a) !== time(b)) return time(a) - time(b); // earlier joiner wins
    return a.userId < b.userId ? -1 : 1;
  });
  return best ?? null;
}
