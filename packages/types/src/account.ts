import { z } from "zod";
import { pickSuccessor, type SuccessorCandidate } from "./policy.js";

/**
 * Account-deletion contract + planner (Phase 1.5, SRS FR-6 / GDPR Art. 17).
 *
 * Deletion is **always available**. Its highest-risk logic — what happens to the
 * trips the departing user owns — is resolved by the *pure* {@link planAccountDeletion}
 * here, reusing the same ownership-successor cascade (`pickSuccessor`) the Phase-1.4
 * explicit transfer uses. Keeping the branching pure means the impact the user is
 * warned about (the preview) and the mutation the server executes are computed by
 * one function, so they can never disagree.
 */

/**
 * A member of an owned trip as the deletion planner sees them: the successor
 * cascade's role+tenure, plus the display name for the warning prompt.
 */
export interface DeletableTripMember extends SuccessorCandidate {
  readonly displayName: string;
}

/** An owned trip with its *other* members (the departing owner excluded). */
export interface OwnedTripForDeletion {
  readonly tripId: string;
  readonly tripName: string;
  readonly otherMembers: readonly DeletableTripMember[];
}

/** A trip whose ownership auto-transfers to a successor on deletion. */
export const TripOwnershipTransfer = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
  successorUserId: z.string().uuid(),
  successorDisplayName: z.string(),
});
export type TripOwnershipTransfer = z.infer<typeof TripOwnershipTransfer>;

/** A solo-owned trip that is permanently deleted on account deletion. */
export const TripDeletion = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
});
export type TripDeletion = z.infer<typeof TripDeletion>;

/**
 * The impact of deleting the account — the warning summary shown before confirm
 * ("You own N trips — ownership of X transfers to Y; Z will be deleted"). Doubles
 * as the execution plan server-side: it already carries each `successorUserId`.
 */
export const AccountDeletionImpact = z.object({
  transfers: z.array(TripOwnershipTransfer),
  deletions: z.array(TripDeletion),
});
export type AccountDeletionImpact = z.infer<typeof AccountDeletionImpact>;

/**
 * Delete-account request. Deletion is unconditional (GDPR), but an explicit
 * `confirm: true` guards against an accidental call — the front-end sets it only
 * after the user acknowledges the impact warning.
 */
export const DeleteAccountInput = z.object({ confirm: z.literal(true) });
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

/**
 * Classify every owned trip into a transfer (a successor exists) or a deletion
 * (solo/Guest-only — no one to inherit), reusing the FR-6 successor cascade. Pure
 * and total: the preview endpoint and the deletion transaction both run this over
 * the same rows, so the user is never warned about one thing and dealt another.
 */
export function planAccountDeletion(
  ownedTrips: readonly OwnedTripForDeletion[],
): AccountDeletionImpact {
  const transfers: TripOwnershipTransfer[] = [];
  const deletions: TripDeletion[] = [];

  for (const trip of ownedTrips) {
    // pickSuccessor returns one of `otherMembers` by reference (or null), so the
    // result carries the DeletableTripMember's displayName.
    const successor = pickSuccessor(trip.otherMembers) as DeletableTripMember | null;
    if (successor) {
      transfers.push({
        tripId: trip.tripId,
        tripName: trip.tripName,
        successorUserId: successor.userId,
        successorDisplayName: successor.displayName,
      });
    } else {
      deletions.push({ tripId: trip.tripId, tripName: trip.tripName });
    }
  }

  return { transfers, deletions };
}
