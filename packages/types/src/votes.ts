import { z } from "zod";

/**
 * Voting contract (Phase 2.3, SRS §6 / FR-22–23). Voting is **approval-style**
 * (a member may vote for many options in a category) and **public** — the tally
 * and the voter list are shown to every member on option read. Votes are
 * advisory: they signal sentiment but never decide anything (only a lock does,
 * Phase 2.4).
 *
 * The **staleness rule** ({@link isVoteStale}) lives here as the single, pure,
 * unit-tested definition (decision 3): a vote is stale iff it was cast **before**
 * the option's last material (cost/date) change — a material edit flags prior
 * votes without deleting them (FR-23). The backend computes it on read from the
 * timestamps it already stores; there is no second copy of this rule and no
 * `stale` column.
 */

/** One member's public vote on an option, with its per-vote staleness flag. */
export const OptionVoterView = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  /**
   * The voter's picture, when they have set one — the same field
   * `TripMemberView` carries, so one person looks like themselves wherever the
   * app draws them. Null falls back to generated initials on a colour derived
   * from `userId`, which is why the id travels with the vote.
   */
  avatarUrl: z.string().nullable(),
  votedAt: z.string(),
  /** True iff this vote predates the option's `materialChangedAt` (FR-23). */
  stale: z.boolean(),
});
export type OptionVoterView = z.infer<typeof OptionVoterView>;

/**
 * Is a vote stale? Pure and total — the single definition of vote staleness
 * (FR-23, decision 3). A vote cast at `votedAt` is stale iff the option changed
 * materially afterwards (`materialChangedAt` is later). An option that never had
 * a material edit (`materialChangedAt === null`) has no stale votes.
 */
export function isVoteStale(
  votedAt: string,
  materialChangedAt: string | null,
): boolean {
  if (materialChangedAt === null) return false;
  return new Date(votedAt).getTime() < new Date(materialChangedAt).getTime();
}
