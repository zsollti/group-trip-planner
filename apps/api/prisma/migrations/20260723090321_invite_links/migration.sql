-- CreateEnum
CREATE TYPE "InviteType" AS ENUM ('GLOBAL', 'PERSONAL');

-- AlterTable
ALTER TABLE "trip_memberships" ADD COLUMN     "joinedViaInviteId" UUID;

-- CreateTable
CREATE TABLE "invite_links" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" "InviteType" NOT NULL,
    "role" "TripRole" NOT NULL,
    "token" TEXT NOT NULL,
    "sentToEmail" TEXT,
    "createdById" UUID NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_links_token_key" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "invite_links_tripId_idx" ON "invite_links"("tripId");

-- AddForeignKey
ALTER TABLE "trip_memberships" ADD CONSTRAINT "trip_memberships_joinedViaInviteId_fkey" FOREIGN KEY ("joinedViaInviteId") REFERENCES "invite_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
