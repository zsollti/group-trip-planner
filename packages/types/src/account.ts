import { z } from "zod";
import { pickSuccessor, type SuccessorCandidate } from "./policy.js";
import { displayNameSchema } from "./auth.js";
import { localeSchema } from "./locale.js";

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
 * Your own account's settings: the name you wear, and the language you read.
 *
 * The display name was set once at registration and then frozen — there was no
 * endpoint to change it anywhere in the app. It is the name every other member
 * sees on a proposal, a vote and a message, so an account created in a hurry
 * wore that name to everyone, forever.
 *
 * Reuses {@link displayNameSchema}, the same rule registration is held to,
 * rather than a second one that could accept a name the sign-up form would
 * refuse.
 *
 * **Every field is optional, and a request must carry one of them.** That is
 * what PATCH means, and it is what the two callers need: the rename form knows
 * nothing about the language switch and the switch must not have to re-send a
 * name it never asked about — a form that resubmits a field it does not own is
 * how one screen quietly reverts another's edit. The `refine` keeps an empty body
 * a 400 rather than a silent no-op, so "nothing happened" is never the answer to
 * a request that asked for nothing.
 */
export const UpdateProfileInput = z
  .object({
    displayName: displayNameSchema.optional(),
    /**
     * The language to read the app in. Validated against what this build
     * actually offers, so a language cannot be selected before it is translated —
     * a reader who somehow submits one gets a 400 rather than a half-English
     * screen.
     */
    locale: localeSchema.optional(),
    /**
     * Mark the guided tour done, or offer it again.
     *
     * A boolean in, a timestamp out: the client knows "they finished it", the
     * server knows when. Sent by the tour itself on both exits — finishing and
     * skipping are the same write, because a tour that came back after being
     * dismissed would be an advert rather than an offer.
     */
    tourCompleted: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.locale !== undefined ||
      v.tourCompleted !== undefined,
    { message: "Nothing to change." },
  );
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

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
    const successor = pickSuccessor(
      trip.otherMembers,
    ) as DeletableTripMember | null;
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
