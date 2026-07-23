import { z } from "zod";

/**
 * Locking contract (Phase 2.4, SRS §6 / FR-19,24) — the app's headline
 * concurrency design. Locking records the group's **decision** on an option; it
 * is an authorized, audited state transition guarded by an **atomic conditional
 * write** (compare-and-set on a `version`), and — unlike trip/category edits —
 * it is **not** optimistic in the UI: the client waits for confirmation and, on
 * rejection, is shown the current state rather than an optimistic flip (FR-24).
 *
 * The guard is **category-aware** (decision 2), and which `version` serializes
 * the write depends on the category:
 *  - **multi-select** category → the lock is guarded by the **option's** version
 *    (`status='PROPOSED' AND version=optionVersion`), so two organizers racing to
 *    lock *the same* option → the second is rejected.
 *  - **single-choice** category → the lock is guarded by the **category's**
 *    version, inside a transaction that unlocks the previously-locked sibling and
 *    locks the target, so two organizers racing to lock *different* options in
 *    the same category → the second is rejected (only one decision can stand).
 *
 * The client sends **both** versions it last saw; the backend applies decision 2
 * and picks the authoritative one from the category's `singleChoice` flag — the
 * client never has to encode the rule.
 */

/**
 * Lock an option (Organizers, Active trip). Carries both the option's and the
 * category's last-seen versions; the backend uses the one that serializes this
 * category's decision (see above). A rejected lock is a 409 — reload to see who
 * won.
 */
export const LockOptionInput = z.object({
  optionVersion: z.number().int().nonnegative(),
  categoryVersion: z.number().int().nonnegative(),
});
export type LockOptionInput = z.infer<typeof LockOptionInput>;

/**
 * Unlock a locked option (Organizers, Active trip), carrying the option's
 * last-seen `version`. Unlock frees the decision slot; it needs no category
 * guard (there is no sibling to displace), just a compare-and-set on the option
 * so a stale unlock is a 409.
 */
export const UnlockOptionInput = z.object({
  version: z.number().int().nonnegative(),
});
export type UnlockOptionInput = z.infer<typeof UnlockOptionInput>;
