-- The operator console's own log (post-launch).
--
-- Purely additive: one new table, no column touched on any existing one. The
-- expand/contract discipline the participants migration forced on this project
-- applies to drops, and there are none here — the old API simply never selects
-- from a table it does not know about, so the rolling window is safe.
--
-- No foreign keys on purpose. `actor_email` and `subject` are snapshots, so the
-- record of who marked an account verified outlives both accounts; a row that
-- cascaded away with its subject could not answer the question it exists for.
CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "subject" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- The console's only query: newest first.
CREATE INDEX "admin_audit_events_createdAt_idx" ON "admin_audit_events"("createdAt");
