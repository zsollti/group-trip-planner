-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('OPTION_LOCKED', 'OPTION_UNLOCKED');

-- AlterTable
ALTER TABLE "options" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" UUID;

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "actorId" UUID,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_tripId_idx" ON "audit_events"("tripId");

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
