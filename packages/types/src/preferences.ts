import { z } from "zod";

/**
 * Notification preferences (Phase 5.3, SRS FR-36) — the user-facing controls
 * over the **email** channel that {@link shouldSendMentionEmail} gates on.
 *
 * Two levers, deliberately at different scopes:
 *
 * - a **global** toggle on the user, the blanket "stop emailing me about
 *   mentions";
 * - a **per-trip mute** on the membership, the escape hatch for one noisy trip
 *   without going silent everywhere.
 *
 * Neither touches the **in-app** channel, which is always on: muting a trip
 * quiets your inbox, it does not hide the bell. And neither touches
 * transactional mail (verification, account recovery) — that path never reads a
 * preference at all, which is the guarantee the unsubscribe flow depends on.
 */

/** The caller's global notification preferences. */
export const NotificationPreferences = z.object({
  /** Global "email me when I'm @mentioned". Defaults on; opt-out, not opt-in. */
  emailOnMention: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

/**
 * A preferences update. Every field is optional so the client can send just the
 * toggle it flipped, and adding a preference later never breaks an older client
 * — but at least one must be present, so an empty body is a 400 rather than a
 * silent no-op that looks like success.
 */
export const UpdateNotificationPreferencesInput =
  NotificationPreferences.partial().refine(
    (value) => Object.keys(value).length > 0,
    { message: "Provide at least one preference to update" },
  );
export type UpdateNotificationPreferencesInput = z.infer<
  typeof UpdateNotificationPreferencesInput
>;

/** Set or clear the caller's mute on one trip. */
export const TripMuteInput = z.object({
  muted: z.boolean(),
});
export type TripMuteInput = z.infer<typeof TripMuteInput>;

/** The trip's mute state for the caller, echoed back after a toggle. */
export const TripMuteView = z.object({
  tripId: z.string().uuid(),
  muted: z.boolean(),
});
export type TripMuteView = z.infer<typeof TripMuteView>;
