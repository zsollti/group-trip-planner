import { z } from "zod";

/**
 * Async notification email (Phase 5.2, SRS FR-35/FR-36). Everything in this file
 * is **pure** — the queue's three hard rules (who gets an email, how a retry is
 * spaced, what makes two sends "the same send") are stated once here and tested
 * without a database, a clock, or a mail provider.
 *
 * The channel split this file exists to protect:
 *
 * - **Transactional** mail (verification, password reset, "account exists") is a
 *   strictly separate path. It is sent inline by `EmailService`, never enqueued,
 *   and **never consults a preference** — losing account-critical mail because a
 *   user muted a trip would be a defect, not a feature (FR-36).
 * - **Notification** mail (currently only `@mention`) goes through this queue and
 *   is gated by {@link shouldSendMentionEmail} on every enqueue.
 */

/**
 * What a queued email is. Deliberately narrow: only `MENTION` exists in 5.2
 * because it is the only trigger SRS Phase-5 gives an email channel — proposals
 * and locks stay in-app only, so a busy trip cannot turn into a mail flood. The
 * enum is the extension seam (e.g. a digest in 5.4), never renumbered.
 */
export const EmailJobType = z.enum(["MENTION"]);
export type EmailJobType = z.infer<typeof EmailJobType>;

/**
 * Lifecycle of one queued email.
 *
 * `PENDING` → claimed → `SENDING` → `SENT`, or back to `PENDING` with a later
 * `runAfter` when a send fails and retries remain, or `FAILED` once they are
 * exhausted. `SENDING` is a real persisted state, not a formality: it is what a
 * crashed worker leaves behind, and what {@link isStuckSending} reclaims.
 */
export const EmailJobStatus = z.enum(["PENDING", "SENDING", "SENT", "FAILED"]);
export type EmailJobStatus = z.infer<typeof EmailJobStatus>;

/** How many send attempts a job gets before it is parked as `FAILED`. */
export const MAX_EMAIL_ATTEMPTS = 5;

/**
 * How long a job may sit in `SENDING` before a later worker pass assumes the
 * worker that claimed it died and takes it back. Comfortably longer than any
 * real send (provider timeouts are seconds), short enough that a crash costs
 * minutes, not a lost email.
 *
 * Applied strictly: a claim exactly this old is not yet reclaimable.
 */
export const SENDING_RECLAIM_MS = 5 * 60_000;

/**
 * Backoff before retry `attempt` (1 = the delay after the first failure).
 * Exponential from one minute, capped at an hour so a provider outage does not
 * push a job weeks out: 1m → 2m → 4m → 8m → … → 60m.
 *
 * Pure and clock-free — the caller adds it to `now`, which is what makes the
 * schedule assertable in a unit test.
 */
export function nextRetryDelayMs(attempt: number): number {
  const safe = Math.max(1, Math.floor(attempt));
  const exponential = 60_000 * 2 ** (safe - 1);
  return Math.min(exponential, 60 * 60_000);
}

/**
 * The idempotency key. Two enqueues that produce the same key are the **same
 * send** and the second is dropped by a unique constraint — which is what makes
 * "exactly one email" survive a retried fan-out, a double-delivered socket
 * event, or a worker that crashed between sending and recording the send.
 *
 * For a mention the natural event id is the **message**: one message mentioning
 * one person is one email, no matter how many times the trigger runs. Note it is
 * keyed on the message, not on the mention row — re-resolving mentions for an
 * edited message must not re-mail the same person.
 */
export function emailDedupeKey(input: {
  type: EmailJobType;
  /** The thing that happened — a message id for `MENTION`. */
  eventId: string;
  /** Who the email is for. */
  recipientId: string;
}): string {
  return `${input.type}:${input.eventId}:${input.recipientId}`;
}

/** What the gate needs to know about one candidate recipient. */
export interface MentionEmailCandidate {
  userId: string;
  /** Global "email me when I'm @mentioned" preference. */
  emailOnMention: boolean;
  /** Whether this recipient muted *this* trip. */
  tripMuted: boolean;
  /** Confirmed address; unverified/absent addresses are never mailed. */
  emailVerified: boolean;
  /** False once GDPR anonymization has purged the address (Phase 1.5). */
  hasAddress: boolean;
}

/**
 * Whether a mention email may be enqueued for one recipient (decision: gate at
 * **enqueue** time, not at send time — a job that exists but must not send is a
 * trap, and the queue is easier to reason about when everything in it is meant
 * to go out).
 *
 * All four conditions must hold:
 *
 * 1. the global toggle is on — the user's blanket opt-out;
 * 2. the trip is not muted for them — the per-trip escape hatch for one noisy
 *    trip without going silent everywhere;
 * 3. the address is **verified** — an unverified address is one nobody has
 *    proven they own, and mentioning a user is enough to aim mail at it, so
 *    sending there would make the app a small spam cannon;
 * 4. an address still exists — an anonymized account has none.
 *
 * The actor is not considered here at all: they were already removed upstream by
 * `notificationRecipients`, so self-mentions never reach this gate.
 */
export function shouldSendMentionEmail(
  candidate: MentionEmailCandidate,
): boolean {
  return (
    candidate.emailOnMention &&
    !candidate.tripMuted &&
    candidate.emailVerified &&
    candidate.hasAddress
  );
}

/**
 * Notification-email preferences as the API reports them (the read side 5.3
 * builds its settings screen on; 5.2 only needs the shape to exist so the
 * unsubscribe endpoint has something to answer with).
 */
export const NotificationPreferences = z.object({
  /** Global "email me when I'm @mentioned". */
  emailOnMention: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;
