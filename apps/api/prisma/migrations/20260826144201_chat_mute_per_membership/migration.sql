-- AlterTable
ALTER TABLE "trip_memberships" ADD COLUMN     "chatMuted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chatMutedUntil" TIMESTAMP(3);
