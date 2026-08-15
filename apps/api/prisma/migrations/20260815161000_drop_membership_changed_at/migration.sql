-- The roster stamp goes with the staleness rule it existed for.
--
-- `membershipChangedAt` dated the trip's membership so that a headcount
-- confirmed before it could be flagged as no longer reflecting the roster.
-- With participants there is nothing to flag: a member who leaves takes their
-- `option_participants` rows with them, so the count is never behind. Nothing
-- reads this column now, and a column that is only ever written is worse than
-- no column — it reads as state something depends on.

-- AlterTable
ALTER TABLE "trips" DROP COLUMN "membershipChangedAt";
