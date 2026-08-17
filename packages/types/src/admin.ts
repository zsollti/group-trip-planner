import { z } from "zod";

/**
 * The operator's console (post-launch).
 *
 * This is not a product feature — it is the answer to "the live app is doing
 * something and I cannot see why". Everything here is chosen from the questions
 * that actually come up while running the deployment: did that email go out,
 * are the exchange rates fresh, is the API running the commit I think it is,
 * and why can this one person not create a trip.
 *
 * **It deliberately exposes no trip content.** No option titles, no messages,
 * no cost figures, no destinations — counts and metadata only. The operator has
 * the production database and could read any of it there; the point is that
 * this console cannot, so "what stops an admin reading everyone's chat?" has a
 * structural answer rather than a promise. The one exception is the demo
 * account, whose contents are published in the README.
 */

/**
 * Who the API is, right now.
 *
 * `/health` answers "can I reach Postgres", which stayed green through a
 * previous outage because Postgres was never the thing that was broken. This
 * says which build is actually serving — the API had no equivalent of the web
 * app's `build.txt`, so "did my deploy land" was unanswerable from the API side.
 */
export const AdminSystem = z.object({
  /** The shared contract version this API was built against. */
  contractVersion: z.string(),
  /** Git sha of the running build, or null when it wasn't stamped in. */
  commit: z.string().nullable(),
  /** When this process started — a proxy for "did it restart-loop overnight". */
  startedAt: z.string().datetime(),
  nodeVersion: z.string(),
  /** The env name the API believes it is running as. */
  environment: z.string(),
});
export type AdminSystem = z.infer<typeof AdminSystem>;

/** How much of everything there is. Growth, and a sanity check on the volume. */
export const AdminVolume = z.object({
  users: z.number().int(),
  verifiedUsers: z.number().int(),
  trips: z.number().int(),
  activeTrips: z.number().int(),
  options: z.number().int(),
  messages: z.number().int(),
  /** Bytes on disk under `UPLOAD_DIR`, or null if it could not be read. */
  uploadBytes: z.number().int().nullable(),
  /** Signups per day for the last 30 days, oldest first, zero-filled. */
  signups: z.array(z.object({ date: z.string(), count: z.number().int() })),
});
export type AdminVolume = z.infer<typeof AdminVolume>;

/** One failed send, with the reason the provider gave. */
export const AdminEmailFailure = z.object({
  id: z.string().uuid(),
  /** The snapshotted recipient. An address, which is why this console is gated. */
  to: z.string(),
  type: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type AdminEmailFailure = z.infer<typeof AdminEmailFailure>;

/**
 * The mail queue's health.
 *
 * `stuckSending` is the one that matters and the one nothing else would ever
 * tell you: a job is claimed `SENDING` and then the worker dies, so it sits
 * claimed forever unless something reclaims it. A number above zero here means
 * mail has quietly stopped, while every other signal in the system stays green.
 */
export const AdminEmail = z.object({
  pending: z.number().int(),
  sending: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  /** Claimed longer ago than the reclaim window — a worker that died mid-send. */
  stuckSending: z.number().int(),
  /** Whether an email provider key is configured at all. */
  configured: z.boolean(),
  recentFailures: z.array(AdminEmailFailure),
});
export type AdminEmail = z.infer<typeof AdminEmail>;

/**
 * The exchange-rate snapshot.
 *
 * Conversion fails **silently** by design: with no `EXCHANGE_RATES_URL` the
 * table stays empty and every dashboard reports `converted: null`, which is
 * indistinguishable from the app before conversion existed. That is correct
 * behaviour and completely invisible, so this panel is the only place the
 * difference between "off on purpose" and "broken" can be seen.
 *
 * `asOf` is the feed's own publication date, not when we fetched it — rates
 * publish on working days, so a Sunday snapshot legitimately carries Friday's
 * date and a staleness check has to allow for the weekend.
 */
export const AdminRates = z.object({
  /** Whether a feed URL is configured. False means conversion is off on purpose. */
  configured: z.boolean(),
  currencies: z.number().int(),
  asOf: z.string().nullable(),
  fetchedAt: z.string().datetime().nullable(),
  source: z.string().nullable(),
});
export type AdminRates = z.infer<typeof AdminRates>;

/** Everything the console's landing view shows, in one request. */
export const AdminOverview = z.object({
  system: AdminSystem,
  volume: AdminVolume,
  email: AdminEmail,
  rates: AdminRates,
});
export type AdminOverview = z.infer<typeof AdminOverview>;

/** One of a looked-up user's mail jobs, newest first. */
export const AdminUserEmailJob = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminUserEmailJob = z.infer<typeof AdminUserEmailJob>;

/**
 * A person, as the console sees them: enough to answer "why can't they get in",
 * and nothing about what they have written anywhere.
 *
 * `tripCount` is a count and not a list on purpose — which trips someone
 * belongs to is their business, and the number is what answers "is this account
 * actually in use".
 */
export const AdminUserSummary = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
  /** Null unless the account has been through GDPR erasure. */
  anonymizedAt: z.string().datetime().nullable(),
  /** Whether a local password exists — its absence means Google-only sign-in. */
  hasPassword: z.boolean(),
  tripCount: z.number().int(),
  /** Newest refresh token issued — the closest thing to "last signed in". */
  lastSeenAt: z.string().datetime().nullable(),
  emailJobs: z.array(AdminUserEmailJob),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;

/** The lookup result. Empty rather than 404 when nothing matched. */
export const AdminUserLookup = z.object({
  users: z.array(AdminUserSummary),
});
export type AdminUserLookup = z.infer<typeof AdminUserLookup>;

/**
 * What an operator did, and when.
 *
 * The trip-scoped {@link AuditEvent} could not carry these: its `tripId` is
 * required and cascades from the trip, so a user-level action has nowhere to
 * live. These rows are kept in their own table for the same reason that one
 * exists at all — an action that can change someone else's account should leave
 * a record that outlives the log retention of whatever is hosting the API.
 */
export const AdminAuditAction = z.enum([
  "VERIFICATION_RESENT",
  "USER_MARKED_VERIFIED",
  "DEMO_RESEEDED",
]);
export type AdminAuditAction = z.infer<typeof AdminAuditAction>;

export const AdminAuditEntry = z.object({
  id: z.string().uuid(),
  action: AdminAuditAction,
  /** The operator's email, snapshotted so it survives their account. */
  actorEmail: z.string(),
  /** Who or what it was done to, in words. Null for account-less actions. */
  subject: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

/** The console's own history, newest first. */
export const AdminAuditLog = z.object({
  entries: z.array(AdminAuditEntry),
});
export type AdminAuditLog = z.infer<typeof AdminAuditLog>;

/**
 * What rebuilding the demo trip built.
 *
 * The one place this console reports on trip content, and it is allowed to
 * because the trip in question is the published demo — its members, options and
 * chat are in the README. Counts rather than titles even so: the operator is
 * checking that a rebuild happened, not reading a board.
 *
 * `removedTrips` is the honest part of the answer. The seed deletes the demo
 * account's trips before rebuilding, so this says how many were swept — zero on
 * a database that had none, which is how an operator tells "it built the demo"
 * from "it replaced the demo".
 */
export const AdminDemoSeed = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
  /** The address the demo is signed into with. */
  email: z.string(),
  members: z.number().int(),
  options: z.number().int(),
  decisions: z.number().int(),
  messages: z.number().int(),
  removedTrips: z.number().int(),
});
export type AdminDemoSeed = z.infer<typeof AdminDemoSeed>;
