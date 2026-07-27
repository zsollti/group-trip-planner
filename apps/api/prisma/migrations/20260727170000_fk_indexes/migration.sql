-- Phase 7.3: index every foreign key that had no supporting index.
--
-- Postgres creates an index for a PRIMARY KEY and for a UNIQUE constraint, but
-- *not* for a FOREIGN KEY. The referencing side therefore had no index unless
-- one was added deliberately, or unless the column happened to lead a composite
-- index we had already declared for a query (e.g. messages(channelId, createdAt)).
--
-- The cost that fell out of that is on DELETE, not on SELECT: every delete of a
-- parent row makes Postgres look for referencing children, and with no index
-- that is a sequential scan of the child table. This app deletes parents for
-- real — GDPR account erasure (Phase 1.5) and trip deletion both cascade widely,
-- and `onDelete: SetNull` columns (deletedById, lockedById, actorId, userId on
-- email_jobs, joinedViaInviteId) are updated the same way.
--
-- The 12 below are exactly the single-column FKs that pg_constraint reported as
-- having no index whose leading column matched.

CREATE INDEX "messages_authorId_idx" ON "messages"("authorId");
CREATE INDEX "messages_deletedById_idx" ON "messages"("deletedById");
CREATE INDEX "reactions_userId_idx" ON "reactions"("userId");
CREATE INDEX "notifications_tripId_idx" ON "notifications"("tripId");
CREATE INDEX "email_jobs_userId_idx" ON "email_jobs"("userId");
CREATE INDEX "options_proposerId_idx" ON "options"("proposerId");
CREATE INDEX "options_lockedById_idx" ON "options"("lockedById");
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");
CREATE INDEX "votes_userId_idx" ON "votes"("userId");
CREATE INDEX "trip_memberships_joinedViaInviteId_idx" ON "trip_memberships"("joinedViaInviteId");
CREATE INDEX "invite_links_createdById_idx" ON "invite_links"("createdById");
CREATE INDEX "trip_blocks_blockedById_idx" ON "trip_blocks"("blockedById");
