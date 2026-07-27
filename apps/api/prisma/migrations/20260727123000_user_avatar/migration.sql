-- User profile picture (Phase 6.2).
--
-- Nullable with no default: "no avatar" is a real state the UI renders as
-- generated initials, not a missing value to backfill. Trip.coverImageUrl has
-- existed since Phase 1.1 as a placeholder, so only the user side needs a
-- column.
ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;
