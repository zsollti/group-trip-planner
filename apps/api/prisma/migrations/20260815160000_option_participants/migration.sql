-- Participants replace the fixed headcount.
--
-- Dropping the three headcount columns is what converts every existing
-- fixed-headcount option to WHOLE_GROUP, which is deliberate: the rows record
-- *how many* people an option was priced for and never *which*, so there is
-- nothing to migrate the participation rows from. Anyone who wants one of
-- those options priced for a subset again can switch it to OPT_IN and have
-- the people say so themselves.
--
-- `headcountConfirmedAt` goes with them. It existed only to date a typed
-- number against the trip's `membershipChangedAt`, and a participant list
-- cannot go stale — a member who leaves takes their row with them.

-- CreateEnum
CREATE TYPE "ParticipationMode" AS ENUM ('WHOLE_GROUP', 'OPT_IN');

-- AlterTable
ALTER TABLE "options" ADD COLUMN     "participationMode" "ParticipationMode" NOT NULL DEFAULT 'WHOLE_GROUP',
DROP COLUMN "headcount",
DROP COLUMN "headcountIsFixed",
DROP COLUMN "headcountConfirmedAt";

-- CreateTable
CREATE TABLE "option_participants" (
    "id" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "option_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "option_participants_optionId_idx" ON "option_participants"("optionId");

-- CreateIndex
CREATE INDEX "option_participants_userId_idx" ON "option_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "option_participants_optionId_userId_key" ON "option_participants"("optionId", "userId");

-- AddForeignKey
ALTER TABLE "option_participants" ADD CONSTRAINT "option_participants_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_participants" ADD CONSTRAINT "option_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
